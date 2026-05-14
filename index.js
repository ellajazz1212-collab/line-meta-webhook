const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

function verifyLineSignature(req) {
  const signature = req.headers['x-line-signature'];
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest('base64');
  return hash === signature;
}

async function writeToSheet(lineUserId, fbclid, status) {
  try {
    const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'A:D',
      valueInputOption: 'RAW',
      resource: {
        values: [[now, lineUserId, fbclid || '無', status]]
      }
    });
    console.log('Google Sheet 寫入成功');
  } catch (err) {
    console.error('Google Sheet 寫入失敗:', err.message);
  }
}

async function sendToMetaCAPI(lineUserId, fbclid) {
  const eventTime = Math.floor(Date.now() / 1000);
  const hashedUserId = crypto
    .createHash('sha256')
    .update(lineUserId)
    .digest('hex');

  const userData = { extern_id: hashedUserId };
  if (fbclid) {
    userData.fbc = `fb.1.${Date.now()}.${fbclid}`;
  }

  const payload = {
    data: [{
      event_name: 'CompleteRegistration',
      event_time: eventTime,
      action_source: 'other',
      user_data: userData
    }]
  };

  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`,
      payload
    );
    console.log('META CAPI 回報成功:', JSON.stringify(res.data));
    return '回報成功';
  } catch (err) {
    console.error('META CAPI 回報失敗:', err.response?.data || err.message);
    return '回報失敗';
  }
}

app.post('/webhook', async (req, res) => {
  if (!verifyLineSignature(req)) {
    console.warn('簽名驗證失敗');
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type === 'follow') {
      const lineUserId = event.source.userId;

      let fbclid = null;
      const ref = event.follow?.referralInfo?.ref || '';
      if (ref.startsWith('fbclid_')) {
        fbclid = ref.replace('fbclid_', '');
      }

      console.log('新好友加入:', lineUserId, '| fbclid:', fbclid);
      const status = await sendToMetaCAPI(lineUserId, fbclid);
      await writeToSheet(lineUserId, fbclid, status);
    }
  }

  res.status(200).send('OK');
});

app.get('/', (req, res) => {
  res.send('Webhook server is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

