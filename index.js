const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fetch = require('node-fetch');
const express = require('express');
const pino = require('pino');

// Servidor web obligatorio para que Render detecte el puerto abierto
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Puente de WhatsApp con Baileys activo y funcionando');
});

app.listen(PORT, () => {
    console.log(`Servidor web corriendo en el puerto ${PORT}`);
});

// URL de su cPanel
const URL_CPANEL_WEBHOOK = 'https://solutions360.click/crmsolutions/whatsapp/procesarwha.php';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Lo desactivamos para que no salga descuadrado
        logger: pino({ level: 'fatal' })
    });

    // Si no está pareado, mostramos el código en los logs de forma limpia o usamos QR alternativo
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('--- COPIA ESTE ENLACE PARA VER TU QR CLARO ---');
            console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('¡El puente de WhatsApp esta conectado y listo!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ... (deje abajo el resto del código de mensajes igualito)
}

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('Escanee este codigo QR con su WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('¡El puente de WhatsApp esta conectado y listo!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const sender = msg.key.remoteJid;
            const messageBody = msg.message.conversation || msg.message.extendedTextMessage?.text;

            if (!messageBody) continue;

            console.log(`Mensaje recibido de ${sender}: ${messageBody}`);

            const payload = {
                sender: sender,
                message: messageBody
            };

            try {
                const response = await fetch(URL_CPANEL_WEBHOOK, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' }
                });

                const data = await response.json();
                
                if (data && data.reply) {
                    await sock.sendMessage(sender, { text: data.reply });
                    console.log(`Respuesta enviada: ${data.reply}`);
                }
            } catch (error) {
                console.error('Error al conectar con el cPanel:', error);
            }
        }
    });
}

connectToWhatsApp();
