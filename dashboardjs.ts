import express from 'express';
import * as fs from 'fs';

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  let history: any[] = [];
  if (fs.existsSync('bot-history.json')) {
    try { history = JSON.parse(fs.readFileSync('bot-history.json', 'utf-8')); } catch (e) { history = []; }
  }

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
        .card h3 { margin: 0 0 10px 0; color: #94a3b8; font-size: 14px; }
        .card p { margin: 0; font-size: 28px; font-weight: bold; color: #34d399; }
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
          <div class="card"><h3>Total Coins Collected</h3><p>${history.length}</p></div>
        </div>
        <h2>Portfolio History</h2>
        <table>
          <thead><tr><th>Time</th><th>Token</th><th>Amount Spent</th><th>Price</th><th>Etherscan</th></tr></thead>
          <tbody>
            ${history.length === 0 ? '<tr><td colspan="5" style="text-align:center;">Waiting for first JO&SNO trade...</td></tr>' : 
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

app.listen(PORT, () => {
  console.log(`📊 [JO&SNO] Dashboard running live at: http://localhost:${PORT}`);
});