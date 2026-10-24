const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fetch = require('node-fetch');
const express = require('express');
const pino = require('pino');

// 🚀 Función puente definitiva usando el endpoint universal de IA Studio
async function consultarGeminiDirecto(promptCompleto) {
    const apiKey = process.env.GEMINI_KEY; 
    
    if (!apiKey) {
        console.error("❌ ERROR CRÍTICO: La variable GEMINI_KEY no está configurada en Render.");
        return null;
    }

    const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    
    const promptConRol = `Eres el asistente virtual experto de ventas de DBD Suministros. Atiende de forma amable y comercial a los clientes sobre computadores y portátiles. 
    
Mensaje del cliente: ${promptCompleto}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gemini-1.5-flash",
                messages: [
                    { role: "system", content: "Eres el asistente virtual de DBD Suministros." },
                    { role: "user", content: promptConRol }
                ],
                temperature: 0.7
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error("❌ ERROR DEVUELTO POR GOOGLE:", JSON.stringify(data.error));
            return null;
        }

        const textoGenerado = data.choices?.[0]?.message?.content;
        return textoGenerado ? textoGenerado.trim() : null;

    } catch (error) {
        console.error("❌ ERROR DE RED EN FETCH CON GEMINI:", error);
        return null;
    }
}

// Servidor web obligatorio para Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Puente de WhatsApp con Baileys activo y funcionando');
});

app.listen(PORT, () => {
    console.log(`Servidor web corriendo en el puerto ${PORT}`);
});

const URL_CPANEL_WEBHOOK = process.env.URL_CPANEL_WEBHOOK || 'https://bdb.solutions360.click/crmsolutions/whatsapp/ia.php';
const contactoCache = {};
const chatsPausados = {};
const TIEMPO_PAUSA = 10 * 60 * 1000;

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

            if (msg.key.fromMe) {
                chatsPausados[sender] = Date.now() + TIEMPO_PAUSA;
                console.log(`[HUMANO INTERVINO] Pausando el bot para ${sender} durante 10 minutos.`);
                continue;
            }

            if (chatsPausados[sender] && Date.now() < chatsPausados[sender]) {
                continue;
            } else if (chatsPausados[sender]) {
                delete chatsPausados[sender];
            }

            const messageBody = msg.message.conversation || msg.message.extendedTextMessage?.text;
            if (!messageBody) continue;

            let numeroLimpio = sender;
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
                        } catch (e) {}
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

            try {
                await sock.presenceSubscribe(sender);
                await sock.sendPresenceUpdate('composing', sender);

                let respuestaIA = await consultarGeminiDirecto(messageBody);
                let textoFinalRespuesta = "";

                if (respuestaIA) {
                    textoFinalRespuesta = respuestaIA;
                } else {
                    const payload = {
                        sender: numeroLimpio, 
                        message: messageBody,
                        sender_original: sender
                    };

                    const response = await fetch(URL_CPANEL_WEBHOOK, {
                        method: 'POST',
                        body: JSON.stringify(payload),
                        headers: { 'Content-Type': 'application/json' }
                    });

                    const textoCrudo = await response.text();
                    const data = JSON.parse(textoCrudo);
                    textoFinalRespuesta = data.reply || "¡Hola! Tomo nota en DBD Suministros.";
                }

                await sock.sendMessage(sender, { text: textoFinalRespuesta });
                console.log(`Respuesta enviada con éxito: ${textoFinalRespuesta}`);

            } catch (error) {
                console.error('Error procesando el mensaje:', error);
                await sock.sendMessage(sender, { text: "¡Hola! Un asesor de DBD Suministros te contactará de inmediato." });
            }
        }
    });
}

connectToWhatsApp();
