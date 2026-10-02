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

            // Resolución avanzada para cuentas con LID / Privacidad de Meta
            let numeroLimpio = sender;

            if (sender.includes('@s.whatsapp.net')) {
                numeroLimpio = sender.split('@')[0];
            } else if (sender.includes('@lid')) {
                // Si el mensaje viene con @lid, intentamos buscar si el chat tiene mapeado el JID alternativo en el Store o en msg.key.participant/remoteJid
                // O si el objeto de mensaje trae el número real en otra propiedad interna de Baileys
                if (msg.key.participant && msg.key.participant.includes('@s.whatsapp.net')) {
                    numeroLimpio = msg.key.participant.split('@')[0];
                } else {
                    // Si el remitente es estrictamente un LID, consultamos si Baileys lo tiene en su caché de contactos
                    let cachedContact = sock.store?.contacts?.[sender];
                    if (cachedContact && cachedContact.id && cachedContact.id.includes('@s.whatsapp.net')) {
                        numeroLimpio = cachedContact.id.split('@')[0];
                    } else {
                        // Último recurso: si el teléfono vinculado tiene guardado el contacto, 
                        // forzamos la extracción numérica si hay un patrón válido, o pasamos el LID señalizándolo limpio
                        let extracted = sender.replace(/[^0-9]/g, '');
                        numeroLimpio = extracted.length >= 10 ? extracted : sender.split('@')[0];
                    }
                }
            }

            console.log(`Mensaje recibido de ${sender} (Número extraído: ${numeroLimpio}): ${messageBody}`);

            const payload = {
                sender: numeroLimpio, // Enviamos el número real detectado al cPanel
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
