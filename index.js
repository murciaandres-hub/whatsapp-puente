const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const axios = require('axios');
const pino = require('pino');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('¡Conectado a WhatsApp exitosamente!');
        }
    });

    // Capturar mensajes entrantes
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const sender = msg.key.remoteJid;
            const messageText = msg.message.conversation || 
                                msg.message.extendedTextMessage?.text || 
                                msg.message.imageMessage?.caption || '';

            if (!messageText.trim()) continue;

            console.log(`Mensaje recibido de ${sender}: ${messageText}`);

            try {
                // 🚀 ENVIAR AL ARCHIVO ia.php EN TU cPanel
                const phpResponse = await axios.post('https://tu-dominio-cpanel.com/ia.php', {
                    sender: sender,
                    message: messageText
                }, { timeout: 25000 });

                let respuestaFinal = "";

                // Asegurar que extraemos correctamente la respuesta del cPanel
                if (phpResponse.data) {
                    if (typeof phpResponse.data === 'string') {
                        respuestaFinal = phpResponse.data;
                    } else if (phpResponse.data.reply) {
                        respuestaFinal = phpResponse.data.reply;
                    }
                }

                // Fallback de seguridad por si viene vacío
                if (!respuestaFinal || respuestaFinal.trim() === "") {
                    respuestaFinal = "¡Hola! Recibimos tu mensaje en DBD Suministros.";
                }

                console.log(`Respuesta enviada a WhatsApp: ${respuestaFinal}`);

                // Enviar la respuesta de vuelta a WhatsApp
                await sock.sendMessage(sender, { text: respuestaFinal });

            } catch (error) {
                console.error("Error al conectar con el cPanel:", error.message);
                await sock.sendMessage(sender, { text: "¡Hola! Tomo nota de tu solicitud en DBD Suministros para gestionarla de inmediato." });
            }
        }
    });
}

// Servidor web express para mantener vivo el servicio en Render
app.get('/', (req, res) => {
    res.send('Puente de WhatsApp activo para DBD Suministros');
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
    connectToWhatsApp();
});
