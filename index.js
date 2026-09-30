const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fetch = require('node-fetch');

// URL de su cPanel que ya configuramos
const URL_CPANEL_WEBHOOK = 'https://solutions360.click/crmsolutions/whatsapp/procesarwha.php';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log(' Escanee este codigo QR con su WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('¡El puente de WhatsApp esta conectado y listo!');
});

client.on('message', async (msg) => {
    if (msg.fromMe) return;

    console.log(`Mensaje recibido de ${msg.from}: ${msg.body}`);

    const payload = {
        sender: msg.from,
        message: msg.body
    };

    try {
        const response = await fetch(URL_CPANEL_WEBHOOK, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();
        
        if (data && data.reply) {
            await client.sendMessage(msg.from, data.reply);
            console.log(`Respuesta enviada: ${data.reply}`);
        }
    } catch (error) {
        console.error('Error al conectar con el cPanel:', error);
    }
});

client.initialize();
