const tmi = require('tmi.js');
const express = require('express');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const axios = require('axios'); // Utilise axios pour simplifier les appels API

const dotenv = require('dotenv');
dotenv.config();

const API_KEY = process.env.API_KEY;
const TMI_USERNAME = process.env.TMI_USERNAME;
const TMI_PASSWORD = process.env.TMI_PASSWORD;

// Port unique pour le serveur
const PORT = 3000;

// Stocke les paris
let bets = {};

// Servir les fichiers frontend
app.use(express.static('public'));

// Lancement du serveur
server.listen(PORT, () => {
    console.log(`Serveur lancé sur http://localhost:${PORT}`);
});

// Configuration du bot Twitch
const client = new tmi.Client({
    options: { debug: true },
    identity: {
        username: TMI_USERNAME, // Nom du bot Twitch
        password: TMI_PASSWORD, // Token OAuth
    },
    channels: [TMI_USERNAME], // Nom de la chaîne Twitch
});

// Connexion au chat Twitch
client.connect().then(() => {
    console.log('Bot connecté à Twitch !');
});

// Écoute des messages du chat
client.on('message', (channel, tags, message, self) => {
    if (self) return;

    // Vérifie si le message correspond à une commande de pari avec montant
    const match = message.match(/^!(\d+)\s+(\d+)$/); // Capture le numéro et le montant
    if (match) {
        const segment = parseInt(match[1], 10); // Numéro du segment (1, 2, 5, 10, 20)
        const amount = parseInt(match[2], 10); // Montant parié
        const username = tags['display-name']; // Nom de l'utilisateur

        if ([1, 2, 5, 10, 20].includes(segment)) {
            // Vérifie si l'utilisateur a déjà parié
            if (bets[username]) {
                client.say(channel, `${username}, vous avez déjà parié et ne pouvez pas parier à nouveau.`);
                return;
            }

            // Valide les points disponibles pour l'utilisateur
            validateUserPoints(username, amount)
                .then((isValid) => {
                    if (isValid) {
                        // Enregistre le pari
                        bets[username] = { segment, amount }; // Stocke le segment et la mise
                        deleteUserPoints(username, amount); // Retire les points de l'utilisateur

                        console.log(`${username} a parié ${amount} points sur le ${segment}.`);
                        client.say(channel, `${username}, vous avez parié ${amount} points sur le ${segment}.`);

                        // Met à jour le frontend
                        io.emit('updateBets', bets);
                    } else {
                        client.say(channel, `${username}, vous n'avez pas assez de points pour parier ${amount}.`);
                    }
                })
                .catch((err) => {
                    console.error(`Erreur lors de la validation des points pour ${username}:`, err);
                    client.say(channel, `${username}, une erreur est survenue lors de la validation de votre pari.`);
                });
        } else {
            client.say(channel, `${username}, segment invalide. Pariez sur 1, 2, 5, 10 ou 20.`);
        }
    }
});

// Gestion des commandes WebSocket depuis le frontend
io.on('connection', (socket) => {
    console.log('Client connecté au WebSocket.');

    // Relaye l'événement "spin" à tous les clients
    socket.on("spin", () => {
        console.log('Commande "spin" reçue depuis le panel admin !');
        io.emit("spin"); // Relaye l'événement à tous les clients
    });

    socket.on("reset", () => {
        console.log('Commande "reset" reçue depuis le panel admin !');
        bets = {}; // Réinitialisation globale de l'objet bets
        io.emit("updateBets", bets); // Notifie tous les clients
        console.log("Paris réinitialisés globalement.");
    });

    socket.on("spinResult", async ({ segment }) => {
        console.log(`Segment gagnant reçu : ${segment.text}`);
        console.log("Paris actuels avant réinitialisation :", bets);
    
        let winners;
    
        if (segment.text === "BONUS") {
            // BONUS : Tout le monde gagne, quelle que soit leur mise
            winners = Object.keys(bets); // Récupère tous les utilisateurs ayant parié
        } else {
            // Identifier les gagnants pour les autres segments
            winners = Object.keys(bets).filter((username) => {
                return bets[username].segment === parseInt(segment.text, 10); // Vérifie si l'utilisateur a parié sur le segment gagnant
            });
        }
    
        if (winners.length > 0) {
            const winnerMessage = winners.map((winner) => `${winner}`).join(", ");
            const message = `🎉 Félicitations aux gagnants : ${winnerMessage} ! Le segment gagnant était "${segment.text}". 🎯`;
    
            // Envoie un message dans le chat Twitch
            client.say("mromnes_", message);
    
            // Calcul des gains pour chaque gagnant
            for (const winner of winners) {
                const betAmount = bets[winner].amount; // Mise de l'utilisateur
                const multiplier = segment.text === "BONUS"
                    ? (Math.random() < 0.5 ? 20 : 100) // Multiplicateur aléatoire pour BONUS
                    : parseInt(segment.text, 10); // Multiplieur basé sur le segment gagnant
                const totalPoints = betAmount * multiplier;
    
                console.log(
                    `${winner} gagne ${totalPoints} points (mise : ${betAmount}, multiplicateur : ${multiplier}).`
                );
    
                try {
                    await addPointsToUser(winner, totalPoints);
                    console.log(`Points attribués à ${winner}: ${totalPoints}`);
                } catch (error) {
                    console.error(`Erreur lors de l'attribution des points à ${winner}.`);
                }
            }
        } else {
            const noWinnerMessage = `😢 Aucun gagnant cette fois. Le segment gagnant était "${segment.text}".`;
            client.say("mromnes_", noWinnerMessage);
    
            console.log(noWinnerMessage);
        }
    
        // Réinitialiser les paris globalement après traitement
        bets = {};
        io.emit("updateBets", bets); // Mettre à jour côté client
        console.log("Paris réinitialisés après spinResult.");
    });    
});

    

async function addPointsToUser(viewer_identifier, action_value) {
    try {
        const response = await axios.post(
            `https://wapi.wizebot.tv/api/currency/${API_KEY}/action/add/${viewer_identifier}/${action_value}`,
            {},
            {
                headers: {
                    Authorization: `Bearer ${API_KEY}`,
                },
            }
        );
        console.log(`Points ajoutés à ${viewer_identifier}: ${action_value}`);
        return response.data;
    } catch (error) {
        console.error(
            `Erreur lors de l'ajout des points à ${viewer_identifier}:`,
            error.response?.data || error.message
        );
        throw error;
    }
}

async function validateUserPoints(username, amount) {
    try {
        const response = await axios.get(
            `https://wapi.wizebot.tv/api/currency/${API_KEY}/get/${username}`,
            {
                headers: {
                    Authorization: `Bearer ${API_KEY}`,
                },
            }
        );

        const userPoints = response.data.currency; // Points disponibles
        console.log(`${username} dispose de ${userPoints} points.`);
        return userPoints >= amount; // Vérifie si l'utilisateur peut parier
    } catch (error) {
        console.error(`Erreur lors de la récupération des points pour ${username}:`, error.response?.data || error.message);
        throw error;
    }
}

async function deleteUserPoints(username, amount) {
    try {
        const response = await axios.post(
            `https://wapi.wizebot.tv/api/currency/${API_KEY}/action/remove/${username}/${amount}`,
            {},
            {
                headers: {
                    Authorization: `Bearer ${API_KEY}`,
                },
            }
        );

        console.log(`${username} a retiré ${amount} points.`);
    } catch (error) {
        console.error(`Erreur lors de la retiré des points pour ${username}:`, error.response?.data || error.message);
        throw error;
    }
}