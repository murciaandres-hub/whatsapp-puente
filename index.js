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

const URL_CPANEL_WEBHOOK = 'https://solutions360.click/crmsolutions/whatsapp/ia.php';
// Memoria caché local segura para relacionar LIDs con números reales
const contactoCache = {};

// Memoria para llevar el control de chats pausados por intervención humana
const chatsPausados = {};
const TIEMPO_PAUSA = 10 * 60 * 1000; // 10 minutos de pausa cuando tú escribes

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
            if (!msg.message) continue;

            const sender = msg.key.remoteJid;

            // SI TÚ ESCRIBES (fromMe): Pausamos el bot para este chat y no procesamos nada
            if (msg.key.fromMe) {
                chatsPausados[sender] = Date.now() + TIEMPO_PAUSA;
                console.log(`[HUMANO INTERVINO] Pausando el bot para ${sender} durante 10 minutos.`);
                continue;
            }

            // Validar si el chat está actualmente pausado por intervención humana reciente
            if (chatsPausados[sender] && Date.now() < chatsPausados[sender]) {
                console.log(`[BOT EN PAUSA] Mensaje ignorado para ${sender} porque hay un humano atendiendo.`);
                continue;
            } else if (chatsPausados[sender]) {
                // Si ya pasó el tiempo, borramos la pausa
                delete chatsPausados[sender];
            }

            const messageBody = msg.message.conversation || msg.message.extendedTextMessage?.text;

            if (!messageBody) continue;

            let numeroLimpio = sender;

            // Extracción segura usando caché local y metadatos
            if (sender.includes('@lid')) {
                if (contactoCache[sender]) {
                    numeroLimpio = contactoCache[sender];
                } else {
                    let jidReal = msg.key.participant || msg.participant || null;
                    
                    if (jidReal && jidReal.includes('@s.whatsapp.net')) {
                        numeroLimpio = jidReal.split('@')[0];
                        contactoCache[sender] = numeroLimpio;
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
                    if (data.imagenUrl && typeof data.imagenUrl === 'string' && data.imagenUrl.trim() !== '') {
                        await sock.sendMessage(sender, { 
                            image: { url: data.imagenUrl.trim() }, 
                            caption: data.reply 
                        });
                        console.log(`Respuesta con imagen enviada: ${data.imagenUrl}`);
                    } else {
                        await sock.sendMessage(sender, { text: data.reply });
                        console.log(`Respuesta de texto enviada: ${data.reply}`);
                    }
                }
            } catch (error) {
                console.error('Error al conectar con el cPanel:', error);
            }
        }
    });
}

connectToWhatsApp();
