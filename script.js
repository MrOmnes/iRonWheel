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
            // Valide les points disponibles pour l'utilisateur
            validateUserPoints(username, amount)
                .then((isValid) => {
                    if (isValid) {
                        // Enregistre le pari
                        if (!bets[username]) {
                            bets[username] = {};
                        }
                        deleteUserPoints(username, amount);
                        bets[username][segment] = amount; // Enregistre la mise pour ce segment

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

    socket.on('spinResult', async ({ segment, bets }) => {
        console.log(`Segment gagnant reçu : ${segment.text}`);
        console.log('Paris actuels :', bets);

        // Identifier les gagnants
        const winners = Object.keys(bets).filter((username) => {
            // Convertir le numéro du segment en chaîne pour comparaison
            const segmentKey = String(segment.text);
            return bets[username][segmentKey]; // Vérifie si l'utilisateur a parié sur ce segment
        });

        if (winners.length > 0) {
            const winnerMessage = winners.map((winner) => `${winner}`).join(', ');
            const message = `🎉 Félicitations aux gagnants : ${winnerMessage} ! Le segment gagnant était "${segment.text}". 🎯`;

            // Envoie un message dans le chat Twitch
            client.say('mromnes_', message);

            // Calcul des gains pour chaque gagnant
            // Calcul des gains pour chaque gagnant
for (const winner of winners) {
    const betAmount = bets[winner][String(segment.text)]; // Mise de l'utilisateur
    const multiplier = parseInt(segment.text, 10); // Multiplieur basé sur le segment gagnant
    const totalPoints = betAmount * multiplier + betAmount; // Gains totaux (multiplicateur + remboursement)

    try {
        await addPointsToUser(winner, totalPoints);
        console.log(`Points attribués à ${winner}: ${totalPoints}`);
    } catch (error) {
        console.error(`Erreur lors de l'attribution des points à ${winner}.`);
    }
}
} else {
    const noWinnerMessage = `😢 Aucun gagnant cette fois. Le segment gagnant était "${segment.text}".`;
    client.say('mromnes_', noWinnerMessage);

    console.log(noWinnerMessage);
}

    // Réinitialiser les paris
    bets = {};
    io.emit('updateBets', bets); // Mettre à jour côté client
});

// Réinitialisation des paris via WebSocket
    socket.on('resetBets', () => {
        bets = {};
        console.log('Paris réinitialisés.');
        io.emit('updateBets', bets); // Met à jour les clients
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