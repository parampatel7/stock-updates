const axios = require('axios');
const fs = require('fs');
let sessionCookie = '';
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function getSession() {
  if (sessionCookie) return;
  const res = await axios.get('https://www.nseindia.com', { headers, timeout: 5000 });
  const sc = res.headers['set-cookie'];
  if (sc) sessionCookie = sc.map(c => c.split(';')[0]).join('; ');
}

async function nseFetch(url) {
  await getSession();
  const res = await axios.get(url, { headers: { ...headers, 'Cookie': sessionCookie }, timeout: 8000, responseType: 'text' });
  return res.data;
}

function toNseDateStr(dateObj) {
  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${d}-${m}-${y}`;
}

async function test() {
  const today = new Date();
  const fut30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const from = toNseDateStr(today);
  const to = toNseDateStr(fut30);
  
  let bulkData = [];
  try {
    const urlAct = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}&csv=false`;
    const respAct = await nseFetch(urlAct);
    let actRows = [];
    if (typeof respAct === 'string' && (respAct.includes('Symbol,Company Name') || respAct.includes('"SYMBOL","COMPANY NAME"'))) {
      const lines = respAct.split('\n');
      const regex = /(".*?"|[^",\s]+)(?=\s*,|\s*$)/g;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = [];
        let match;
        while ((match = regex.exec(line))) {
          cols.push(match[1].replace(/^"|"$/g, '').trim());
        }
        if (cols.length >= 6) {
          actRows.push({
            symbol: cols[0],
            comp: cols[1],
            subject: cols[3],
            exDate: cols[5] !== '-' ? cols[5] : '',
            recDate: cols[6] && cols[6] !== '-' ? cols[6] : ''
          });
        }
      }
    } else {
      const parsed = typeof respAct === 'string' ? JSON.parse(respAct) : respAct;
      actRows = Array.isArray(parsed) ? parsed : (parsed.data || []);
    }
    
    actRows.forEach(row => {
        const sym = (row.symbol || '').toUpperCase();
        if (!sym) return;
        const purpose = (row.subject || row.desc || '').toLowerCase();
        let type = 'Corporate Action';
        let dotClass = 'event-dot--dividend';

        if (purpose.includes('dividend')) { type = 'Dividend'; dotClass = 'event-dot--dividend'; }
        else if (purpose.includes('bonus')) { type = 'Bonus Issue'; dotClass = 'event-dot--bonus'; }
        else if (purpose.includes('split') || purpose.includes('sub-divis')) { type = 'Stock Split'; dotClass = 'event-dot--split'; }
        else if (purpose.includes('right')) { type = 'Rights Issue'; dotClass = 'event-dot--rights'; }

        const dateStr = row.exDate || row.recDate || row.bcEndDate || '';
        if (!dateStr) return;

        bulkData.push({
          symbol: sym,
          company: (row.comp || row.sm_name || row.company || sym).trim(),
          event_type: type,
          dotClass,
          rawDate: dateStr,
          date: (() => {
            try { return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
            catch { return dateStr; }
          })(),
          label: (row.subject || '').trim(),
        });
    });
    console.log("Filtered events for SBICARD:", bulkData.filter(e => e.symbol === 'SBICARD'));
  } catch (e) {
    console.log("Error:", e.message);
  }
}
test();
