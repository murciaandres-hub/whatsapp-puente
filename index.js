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

// Memoria caché local segura para relacionar LIDs con números reales
const contactoCache = {};

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

            let numeroLimpio = sender;

            // Extracción segura usando caché local y metadatos
            if (sender.includes('@lid')) {
                // Si ya lo tenemos guardado en memoria caché, lo usamos
                if (contactoCache[sender]) {
                    numeroLimpio = contactoCache[sender];
                } else {
                    let jidReal = msg.key.participant || msg.participant || null;
                    
                    if (jidReal && jidReal.includes('@s.whatsapp.net')) {
                        numeroLimpio = jidReal.split('@')[0];
                        contactoCache[sender] = numeroLimpio; // Guardamos en caché
                    } else {
                        try {
                            if (sock.signalRepository?.lidMapping) {
                                const mappedPn = await sock.signalRepository.lidMapping.getPNForLID(sender);
                                if (mappedPn) {
                                    numeroLimpio = mappedPn.split('@')[0];
                                    contactoCache[sender] = numeroLimpio;
                                }
                            }
                        } catch (e) {
                            // Ignorar error si no hay mapeo en frío
                        }

                        // Si sigue siendo LID puro sin rastro, asignamos etiqueta limpia para el cPanel
                        if (numeroLimpio.includes('@lid')) {
                            numeroLimpio = "LID_" + sender.replace(/[^0-9]/g, '');
                        }
                    }
                }
            } else if (sender.includes('@s.whatsapp.net')) {
                numeroLimpio = sender.split('@')[0];
                contactoCache[sender] = numeroLimpio;
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
            // Verificamos si el PHP mandó una imagen adjunta de forma segura
            if (data.imagenUrl && typeof data.imagenUrl === 'string' && data.imagenUrl.trim() !== '') {
                await sock.sendMessage(sender, { 
                    image: { url: data.imagenUrl.trim() }, 
                    caption: data.reply 
                });
                console.log(`Respuesta con imagen enviada: ${data.imagenUrl}`);
            } else {
                // Si no hay imagen, envía solo el texto formateado
                await sock.sendMessage(sender, { text: data.reply });
                console.log(`Respuesta de texto enviada: ${data.reply}`);
            }
        }
    } catch (error) {
        console.error('Error al conectar con el cPanel:', error);
    }
}

connectToWhatsApp();
