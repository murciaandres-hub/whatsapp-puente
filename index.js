const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fetch = require('node-fetch');
const express = require('express');
const pino = require('pino');

// 🧠 NUESTRA PROPIA IA CASERA CON MEMORIA Y BASE DE CONOCIMIENTOS PARA DBD SUMINISTROS
const memoriaConversacion = {};

function consultarIAPropia(numeroCliente, mensajeCliente) {
    const texto = mensajeCliente.toLowerCase();
    
    // Inicializar memoria para este cliente si no existe
    if (!memoriaConversacion[numeroCliente]) {
        memoriaConversacion[numeroCliente] = { ultimoTema: 'general', saludoInicial: false };
    }
    
    let respuesta = "";

    // 1. Saludos
    if (texto.includes('hola') || texto.includes('buenos') || texto.includes('buenas') || texto.includes('hi') || texto.includes('que tal')) {
        memoriaConversacion[numeroCliente].ultimoTema = 'general';
        respuesta = "¡Hola! 👋 Bienvenido a **DBD Suministros**. Somos especialistas en tecnología de alto rendimiento, estaciones de trabajo y computadores de alta gama. ¿Qué equipo o componente estás buscando hoy?";
    } 
    // 2. Ubicación / Dirección / Horarios
    else if (texto.includes('direccion') || texto.includes('ubicacion') || texto.includes('donde') || texto.includes('local') || texto.includes('horario') || texto.includes('calle')) {
        memoriaConversacion[numeroCliente].ultimoTema = 'ubicacion';
        respuesta = "📍 Nos encuentras en el **Centro empresarial Tecno 77**, Calle 77 # 15 - 17, Local 102 o 105. Nuestro horario de atención es de Lunes a Sábado de 9:00 AM a 7:00 PM. ¡Será un gusto atenderte!";
    }
    // 3. Portátiles
    else if (texto.includes('portatil') || texto.includes('laptop') || texto.includes('portátiles') || texto.includes('transporte')) {
        memoriaConversacion[numeroCliente].ultimoTema = 'portatiles';
        respuesta = "💻 Contamos con portátiles corporativos y profesionales de alto rendimiento. Tenemos opciones con tarjeta gráfica dedicada para diseño o versiones más ligeras para transporte. ¿Cuál prefieres?";
    } 
    // 4. Estaciones de trabajo
    else if (texto.includes('estacion') || texto.includes('trabajo') || texto.includes('workstation') || texto.includes('render')) {
        memoriaConversacion[numeroCliente].ultimoTema = 'workstations';
        respuesta = "🖥️ Nuestras Estaciones de Trabajo vienen con procesadores potentes y tarjetas NVIDIA RTX profesionales. ¿Qué presupuesto manejas aproximadamente?";
    } 
    // 5. Precios / Catálogo
    else if (texto.includes('precio') || texto.includes('cuanto') || texto.includes('cotizacion') || texto.includes('catalogo') || texto.includes('lista')) {
        memoriaConversacion[numeroCliente].ultimoTema = 'precios';
        respuesta = "📋 Para enviarte el catálogo oficial detallado con modelos y precios exactos, dime por favor si buscas un portátil o una estación de trabajo de escritorio.";
    } 
    // 6. Respuestas neutrales o salidas del bucle
    else if (texto.includes('ninguno') || texto.includes('otro') || texto.includes('nada') || texto.includes('gracias')) {
        memoriaConversacion[numeroCliente].ultimoTema = 'general';
        respuesta = "¡Perfecto! Quedamos a tu disposición. Si necesitas cotizar algún otro equipo, componente o accesorio en DBD Suministros, solo dime.";
    }
    else {
        // Si no hay una palabra clave exacta, respondemos de forma abierta según el contexto sin trabarnos
        const temaPrevio = memoriaConversacion[numeroCliente].ultimoTema;
        if (temaPrevio === 'portatiles') {
            memoriaConversacion[numeroCliente].ultimoTema = 'general';
            respuesta = "¡Entendido! Tenemos modelos excelentes en stock para entrega inmediata. ¿Te gustarìa que un asesor te contacte con los detalles técnicos completos de estos equipos?";
        } else {
            //respuesta = "¡Entendido! Tomo nota detallada de tu solicitud en DBD Suministros para gestionarla con el departamento técnico de inmediato. ¿Hay algún componente específico (como RAM, SSD o tarjeta gráfica) que quieras agregar?";
        }
    }

    return respuesta;
}
// Servidor web obligatorio para Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Puente de WhatsApp con IA Propia activo y funcionando');
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
                contactoCache[sender] = numeroLino = numeroLimpio;
            }

            console.log(`Mensaje recibido de ${sender} (Número resuelto: ${numeroLimpio}): ${messageBody}`);

            try {
                await sock.presenceSubscribe(sender);
                await sock.sendPresenceUpdate('composing', sender);

                // EJECUTAMOS NUESTRA IA CASERA LOCAL (CERO ERRORES DE RED, CERO GOOGLE)
                let textoFinalRespuesta = consultarIAPropia(numeroLimpio, messageBody);

                await sock.sendMessage(sender, { text: textoFinalRespuesta });
                console.log(`Respuesta IA Propia enviada con éxito: ${textoFinalRespuesta}`);

            } catch (error) {
                console.error('Error procesando el mensaje con IA Propia:', error);
                await sock.sendMessage(sender, { text: "¡Hola! Un asesor de DBD Suministros te contactará de inmediato." });
            }
        }
    });
}

connectToWhatsApp();
