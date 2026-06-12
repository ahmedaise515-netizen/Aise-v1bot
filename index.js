const { default: makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason } = require('@baileys/baileys')
const { Boom } = require('@hapi/boom')
const config = require('./config')
const fs = require('fs')

// قراءة الاوامر
const commands = require('./commands')

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session')

    const sock = makeWASocket({
        auth: state,
        browser: Browsers.macOS('Chrome'),
        printQRInTerminal: false
    })

    if (!sock.authState.creds.registered) {
        let code = config.pairCode
        console.log('━━━━━━━━━━')
        console.log('📱 كود الربط بتاعك:')
        console.log(`🔗 ${code}`)
        console.log('━━━━━━━━━━')
        console.log('ادخل الواتساب → الاجهزة المرتبطة → ربط جهاز → ادخل الكود')
        await sock.requestPairingCode(config.botNumber, code)
    }

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode!== DisconnectReason.loggedOut
            console.log('الاتصال قفل، باعيد الاتصال...', shouldReconnect)
            if (shouldReconnect) connectToWhatsApp()
        } else if (connection === 'open') {
            console.log(`✅ ${config.botName} شغال بنجاح`)
        }
    })

    // استقبال الرسائل
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0]
        if (!m.message) return
        if (m.key.remoteJid === 'status@broadcast') return
        if (m.key.fromMe) return

        const from = m.key.remoteJid
        const sender = m.key.participant || m.key.remoteJid
        const text = m.message.conversation || m.message.extendedTextMessage?.text || ''
        const prefix = config.prefix
        if (!text.startsWith(prefix)) return

        const args = text.slice(prefix.length).trim().split(/ +/)
        const command = args.shift().toLowerCase()

        // معلومات الجروب
        m.isGroup = from.endsWith('@g.us')
        if (m.isGroup) {
            try {
                const metadata = await sock.groupMetadata(from)
                const participants = metadata.participants
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'
                const userAdmin = participants.find(p => p.id === sender)?.admin
                const botAdmin = participants.find(p => p.id === botJid)?.admin
                m.isAdmin = userAdmin === 'admin' || userAdmin === 'superadmin'
                m.isBotAdmin = botAdmin === 'admin' || botAdmin === 'superadmin'
            } catch {}
        }

        m.args = args
        m.quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage? {
            key: m.message.extendedTextMessage.contextInfo,
            msg: m.message.extendedTextMessage.contextInfo.quotedMessage,
            download: async () => {
                const quoted = await sock.loadMessage(from, m.message.extendedTextMessage.contextInfo.stanzaId)
                return await quoted.message.download()
            }
        } : null
        m.pushName = m.pushName || 'مستخدم'
        m.mentionedJid = m.message.extendedTextMessage?.contextInfo?.mentionedJid || []

        // شغل الاوامر
        commands(sock, m, command, from, sender)
    })

    return sock
}

connectToWhatsApp()
