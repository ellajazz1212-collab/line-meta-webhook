const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN;

// 驗證 LINE 簽名
function verifyLineSignature(req) {
  const signature = req.headers['x-line-signature'];
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest('base64');
  return hash === signature;
}

// 回報 META CAPI
async function sendToMetaCAPI(lineUserId) {
  const eventTime = Math.floor(Date.now() / 1000);
  const hashedUserId = crypto
    .createHash('sha256')
    .update(lineUserId)
    .digest('hex');

  const payload = {
    data: [
      {
        event_name: 'Lead',
        event_time: eventTime,
        action_source: 'other',
        user_data: {
          extern_id: hashedUserId
        }
      }
    ]
  };

  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`,
      payload
    );
    console.log('META CAPI 回報成功:', JSON.stringify(res.data));
  } catch (err) {
    console.error('META CAPI 回報失敗:', err.response?.data || err.message);
  }
}

// LINE Webhook 接收端點
app.post('/webhook', async (req, res) => {
  if (!verifyLineSignature(req)) {
    console.warn('簽名驗證失敗');
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type === 'follow') {
      const lineUserId = event.source.userId;
      console.log('新好友加入:', lineUserId);
      await sendToMetaCAPI(lineUserId);
    }
  }

  res.status(200).send('OK');
});

// 健康檢查
app.get('/', (req, res) => {
  res.send('Webhook server is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
