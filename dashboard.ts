import express from 'express';
import * as fs from 'fs';

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
const CONFIG_FILE = 'bot-config.json';

function getConfig() {
  const defaultConfig = {
    maxTokenPrice: 1.10,
    minBuyUSD: 1.00,
    maxBuyUSD: 1.30,
    maxGasFeeUSD: 1.00,
    excludeMemecoins: true,
    excludeDuplicates: true,
    excludeStablecoins: true
  };
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
    } catch (e) {
      return defaultConfig;
    }
  }
  return defaultConfig;
}

app.get('/', (req, res) => {
  let history: any[] = [];
  if (fs.existsSync('bot-history.json')) {
    try { history = JSON.parse(fs.readFileSync('bot-history.json', 'utf-8')); } catch (e) { history = []; }
  }

  const config = getConfig();
  const totalSpent = history.reduce((acc, curr) => acc + curr.amountUSD, 0);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>JO&SNO - Uniswap Gem Bot Dashboard</title>
      <style>
        body { font-family: sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; }
        h1 { color: #38bdf8; }
        .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 25px; }
        .card { background: #1e293b; padding: 20px; border-radius: 12px; }
        .card h3 { margin: 0 0 10px 0; color: #94a3b8; font-size: 14px; text-transform: uppercase; }
        .card p { margin: 0; font-size: 28px; font-weight: bold; color: #34d399; }
        .form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
        label { display: block; font-size: 13px; color: #94a3b8; margin-bottom: 5px; }
        input { width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; color: #f8fafc; border-radius: 6px; box-sizing: border-box; }
        button { background: #38bdf8; color: #0f172a; border: none; padding: 10px 15px; font-weight: bold; border-radius: 6px; cursor: pointer; margin-top: 15px; }
        button:hover { background: #0ea5e9; }
        table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; margin-top: 25px; }
        th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #334155; font-size: 14px; }
        th { background: #334155; color: #cbd5e1; }
        a { color: #38bdf8; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🏢 JO&SNO Uniswap Gem Hunter Dashboard</h1>
        
        <div class="cards">
          <div class="card"><h3>Total Capital Deployed</h3><p>$${totalSpent.toFixed(2)} USD</p></div>
          <div class="card"><h3>Total Unique Coins Bought</h3><p>${history.length}</p></div>
        </div>

        <div class="card" style="margin-bottom: 25px;">
          <h3>⚙️ Bot Selection & Trade Criteria Settings</h3>
          <form action="/update-config" method="POST">
            <div class="form-grid">
              <div>
                <label>Max Token Price ($)</label>
                <input type="number" step="0.01" name="maxTokenPrice" value="${config.maxTokenPrice}" required />
              </div>
              <div>
                <label>Max Gas Fee Limit ($ USD)</label>
                <input type="number" step="0.01" name="maxGasFeeUSD" value="${config.maxGasFeeUSD}" required />
              </div>
              <div>
                <label>Min Buy Amount ($ USD)</label>
                <input type="number" step="0.01" name="minBuyUSD" value="${config.minBuyUSD}" required />
              </div>
              <div>
                <label>Max Buy Amount ($ USD)</label>
                <input type="number" step="0.01" name="maxBuyUSD" value="${config.maxBuyUSD}" required />
              </div>
            </div>
            <button type="submit">Save & Apply New Criteria</button>
          </form>
        </div>

        <h2>Portfolio History (Unique Coins Only)</h2>
        <table>
          <thead><tr><th>Time</th><th>Token</th><th>Amount Spent</th><th>Price</th><th>Etherscan</th></tr></thead>
          <tbody>
            ${history.length === 0 ? '<tr><td colspan="5" style="text-align:center; color:#64748b;">Waiting for first JO&SNO trade...</td></tr>' : 
              history.map(t => `
                <tr>
                  <td>${new Date(t.timestamp).toLocaleString()}</td>
                  <td><strong>${t.symbol}</strong></td>
                  <td>$${t.amountUSD.toFixed(2)}</td> <td>$${t.price.toFixed(4)}</td>
                  <td><a href="https://etherscan.io/tx/${t.txid}" target="_blank">View on Etherscan</a></td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `);
});

app.post('/update-config', (req, res) => {
  const currentConfig = getConfig();
  const newConfig = {
    ...currentConfig,
    maxTokenPrice: parseFloat(req.body.maxTokenPrice),
    maxGasFeeUSD: parseFloat(req.body.maxGasFeeUSD),
    minBuyUSD: parseFloat(req.body.minBuyUSD),
    maxBuyUSD: parseFloat(req.body.maxBuyUSD)
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  console.log('⚙️ [JO&SNO] Configuration criteria updated via Dashboard:', newConfig);
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`📊 [JO&SNO] Dashboard running live at: http://localhost:${PORT}`);
});