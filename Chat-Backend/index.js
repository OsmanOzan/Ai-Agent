const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);

const app = express();
app.use(express.json());
app.use(cors());

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        enableArithAbort: true
    }
};

const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;
const SECRET = process.env.JWT_SECRET;

app.post('/api/login', (req, res) => {
  const { userid, password } = req.body;
  if (userid === AUTH_USER && password === AUTH_PASS) {
    const token = jwt.sign({ userid }, SECRET, { expiresIn: '1h' });
    res.json({ token });
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.use((req, res, next) => {
  if (req.path === '/api/login') return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = auth.split(" ")[1];
  try {
    jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
});

function monthToNumber(month) {
  const months = {
    January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
    July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
  };
  if (!isNaN(month)) return Number(month);
  const normalized = month.charAt(0).toUpperCase() + month.slice(1).toLowerCase();
  return months[normalized] || month;
}

app.get('/api/bill/:subscriberNo', async (req, res) => {
    try {
        await sql.connect(config);
        let { subscriberNo } = req.params;
        let { month, year } = req.query;
        let result;
        if (month && year) {
            const monthNum = monthToNumber(month);
            result = await sql.query`
                SELECT * FROM Bills WHERE subscriber_no = ${subscriberNo} AND year = ${year} AND month = ${monthNum}
            `;
            if (result.recordset.length === 0) {
                return res.status(404).json({ error: `There is no bill for subscriber ${subscriberNo} for ${month} ${year}.` });
            }
        } else {
            result = await sql.query`
                SELECT * FROM Bills WHERE subscriber_no = ${subscriberNo}
            `;
        }
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/bill-detail/:subscriberNo/:year/:month', async (req, res) => {
    try {
        await sql.connect(config);
        const { subscriberNo, year, month } = req.params;
        const monthNum = monthToNumber(month);
        const billResult = await sql.query`
            SELECT * FROM Bills WHERE subscriber_no = ${subscriberNo} AND year = ${year} AND month = ${monthNum}
        `;
        if (billResult.recordset.length === 0) {
            return res.status(404).json({ error: "Bill not found" });
        }
        const bill = billResult.recordset[0];
        const basePlan = 40;
        const dataUsageExtra = Math.max(0, (bill.internet_used_mb - 10000) / 1000 * 1);
        const vatTaxes = Number((bill.total_amount * 0.18).toFixed(2));
        const dueDate = `${year}-${String(monthNum).padStart(2, '0')}-10`;
        res.json({
            subscriber_no: bill.subscriber_no,
            month: `${year}-${monthNum}`,
            amount_due: bill.total_amount,
            due_date: dueDate,
            base_plan: basePlan,
            data_usage_extra: dataUsageExtra,
            vat_taxes: vatTaxes,
            total_due: bill.total_amount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pay-bill', async (req, res) => {
  const { subscriber_no, year, month, amount } = req.body;
  try {
    await sql.connect(config);
    const monthNum = monthToNumber(month);
    const billResult = await sql.query`
      SELECT * FROM Bills WHERE subscriber_no = ${subscriber_no} AND year = ${year} AND month = ${monthNum}
    `;
    if (billResult.recordset.length === 0) {
      return res.status(404).json({ error: "Bill not found" });
    }
    const bill = billResult.recordset[0];
    await sql.query`
      UPDATE Bills SET is_paid = 1 WHERE id = ${bill.id}
    `;
    await sql.query`
      INSERT INTO BillPayments (bill_id, amount_paid) VALUES (${bill.id}, ${amount})
    `;
    res.json({
      subscriber_no,
      month: `${year}-${monthNum}`,
      amount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

app.post('/api/parse-intent', async (req, res) => {
  const { message } = req.body;
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: `
You are an assistant that extracts intent and parameters from user chat messages for a billing system. Reply in JSON only.
If the user asks for a bill summary, reply: {"intent": "query_bill", "subscriber_no": "...", "month": "...", "year": "..."}
If the user asks for a detailed bill, reply: {"intent": "query_bill_detail", "subscriber_no": "...", "month": "...", "year": "..."}
If the user says payment is successful, reply: {"intent": "pay_bill", "subscriber_no": "...", "month": "...", "year": "...", "amount": ...}
Example summary: What's the bill for subscriber 1001 for March 2025?
Example detail: Show me the detailed bill for subscriber 1001, March 2025
Example payment: Payment successful for subscriber 123456, March 2025, $65.00
` },
          { role: "user", content: message }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    const content = response.data.choices[0].message.content;
    res.json(JSON.parse(content));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const firestore = admin.firestore();

app.post('/api/clear-messages', async (req, res) => {
  try {
    const snapshot = await firestore.collection('messages').get();
    const batch = firestore.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});