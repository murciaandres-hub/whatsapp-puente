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
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    // GENERAR UN ENLACE WEB LIMPIO PARA EL CÓDIGO QR
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // Creamos un enlace web usando una API pública de códigos QR
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
            console.log('==================================================');
            console.log('🔗 ABRE ESTE ENLACE EN TU NAVEGADOR PARA ESCANEAR EL QR:');
            console.log(qrImageUrl);
            console.log('==================================================');
        }

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

    // Capturar mensajes entrantes y enviarlos al cPanel con cabeceras anti-403
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
                // Petición hacia tu cPanel con los headers de navegador para evitar el error 403
                const phpResponse = await axios.post('https://bdb.solutions360.click/crmsolutions/whatsapp/ia.php', {
                    sender: sender,
                    message: messageText
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    },
                    timeout: 25000 
                });

                let respuestaFinal = "";

                if (phpResponse.data) {
                    if (typeof phpResponse.data === 'string') {
                        respuestaFinal = phpResponse.data;
                    } else if (phpResponse.data.reply) {
                        respuestaFinal = phpResponse.data.reply;
                    }
                }

                if (!respuestaFinal || respuestaFinal.trim() === "") {
                    respuestaFinal = "¡Hola! Recibimos tu mensaje en DBD Suministros.";
                }

                await sock.sendMessage(sender, { text: respuestaFinal });

            } catch (error) {
                console.error("Error al conectar con el cPanel:", error.message);
                await sock.sendMessage(sender, { text: "¡Hola! Recibimos tu mensaje en DBD Suministros. Estamos procesando tu solicitud." });
            }
        }
    });
}

app.get('/', (req, res) => {
    res.send('Puente de WhatsApp activo para DBD Suministros');
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
    connectToWhatsApp();
});
