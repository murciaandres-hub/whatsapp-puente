const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fetch = require('node-fetch');
const express = require('express');
const pino = require('pino');

// Servidor web obligatorio para Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Puente de WhatsApp con Baileys activo y funcionando');
});

app.listen(PORT, () => {
    console.log(`Servidor web corriendo en el puerto ${PORT}`);
});

const URL_CPANEL_WEBHOOK = 'https://solutions360.click/crmsolutions/whatsapp/procesarwha.php';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('--- ABRE ESTE ENLACE EN TU NAVEGADOR PARA VER EL QR ---');
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

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const sender = msg.key.remoteJid;
            const messageBody = msg.message.conversation || msg.message.extendedTextMessage?.text;

            if (!messageBody) continue;

            // Extracción inteligente y resolución de LID
            // Extracción inteligente y resolución de LID a número real vía Baileys
            let numeroLimpio = sender;

            // Si el remitente es un LID o un formato interno de WhatsApp
            if (sender.includes('@lid') || !sender.includes('@s.whatsapp.net')) {
                // Buscamos si el número real viene en los datos del participante o en la llave
                let jidReal = msg.key.participant || msg.participant || null;
                
                if (jidReal && jidReal.includes('@s.whatsapp.net')) {
                    numeroLimpio = jidReal.split('@')[0];
                } else {
                    // Si no hay JID tradicional, revisamos si el objeto trae información de contacto o pushName útil, 
                    // o forzamos a buscar un número válido de celular colombiano/internacional si viene en otro campo.
                    // Si de plano es un LID puro sin rastro del teléfono en el mensaje, usamos un respaldo limpio:
                    numeroLimpio = "NUMERO_NO_DISPONIBLE"; // O el valor que prefieras para identificarlo
                }
            } else if (sender.includes('@s.whatsapp.net')) {
                numeroLimpio = sender.split('@')[0];
            }

            console.log(`Mensaje recibido de ${sender} (Número resuelto: ${numeroLimpio}): ${messageBody}`);

            const payload = {
                sender: numeroLimpio, 
                message: messageBody,
                sender_original: sender
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


