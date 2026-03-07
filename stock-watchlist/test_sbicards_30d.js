const { execSync } = require('child_process');
const axios = require('axios');

async function testServer() {
  try {
    const res = await axios.get('http://localhost:3000/api/upcoming-events?symbols=SBICARD');
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error("error:", e.message);
  }
}
testServer();
