const fs = require('fs');
const axios = require('axios');
async function run() {
  const from = '07-03-2026';
  const to = '06-04-2026';
  try {
    const res1 = await axios.get('https://www.nseindia.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const cookie = res1.headers['set-cookie'] ? res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';
    
    const res2 = await axios.get(`https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}&csv=false`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' }
    });
    
    const text = res2.data;
    if (typeof text === 'string') {
        const lines = text.split('\n');
        for (let line of lines) {
            if (line.includes('SBICARD')) {
                console.log("MATCH:", line);
            }
        }
    }
  } catch(e) {
    console.error(e.message);
  }
}
run();
