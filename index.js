import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { executablePath } from 'puppeteer';
import fs from 'fs';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import crypto from 'crypto';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  // Add stealth plugin and use defaults (all evasion techniques)
  puppeteer.use(StealthPlugin());

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: executablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--lang=zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    ],
  });
  const page = await browser.newPage();
  // expose console.log
  await page.exposeFunction('log', console.log);
  // Set screen size
  await page.setViewport({ width: 1366, height: 768 });
  // goto ncc website
  console.log('goto\thttps://nccmember.ncc.gov.tw/Application/Fun/Fun016.aspx');
  await page.goto('https://nccmember.ncc.gov.tw/Application/Fun/Fun016.aspx', { waitUntil: 'networkidle2' });

  async function resolveCaptcha() {
    // get captcha
    await page.waitForSelector('#imgValid');
    let captchaElemant = await page.$('#imgValid');
    let randomString = crypto.randomBytes(20).toString('hex');
    await captchaElemant.screenshot({ path: `captcha_${randomString}.png` });
    // get captcha text
    let captchaImage = await sharp(`captcha_${randomString}.png`)
    captchaImage = captchaImage.threshold(90)
    captchaImage = await captchaImage.toBuffer()

    const { data: { text } } = await Tesseract.recognize(captchaImage, 'eng')
    let captchaText = text.replace(/[^0-9]/g, '')
    console.log('captcha', captchaText)
    // input captcha
    await page.type('#txbVerify', captchaText);
    // delete captcha
    fs.unlinkSync(`captcha_${randomString}.png`)
  }
  async function submitForm() {
    await resolveCaptcha()
    await page.type('#tx_brand', 'apple');
    await delay(1000);
    await page.click('#bt_select');
  }
  await submitForm()


  page.on('dialog', async dialog => {
    //get alert message
    console.log(dialog.message());
    if (dialog.message() == `驗證碼內容輸入不正確`) {
      await dialog.accept();
      await page.goto('https://nccmember.ncc.gov.tw/Application/Fun/Fun016.aspx', { waitUntil: 'networkidle2' });
      await submitForm()
    } else {
      await dialog.accept();
      await browser.close();
      throw new Error(dialog.message())
    }
  })

  // changed sort to latest
  await page.waitForSelector(`a[href="javascript:__doPostBack('GridView1','Sort$verifydate_desc')"]`);
  await page.click(`a[href="javascript:__doPostBack('GridView1','Sort$verifydate_desc')"]`);
  await page.waitForSelector(`a[href="javascript:__doPostBack('GridView1','Sort$verifydate_desc')"]`);
  await page.click(`a[href="javascript:__doPostBack('GridView1','Sort$verifydate_desc')"]`);
  await page.waitForSelector(`a[href="javascript:__doPostBack('GridView1','Sort$verifydate_desc')"]`);
  // build result
  let result = []
  let linkIds = await page.evaluate(() => [...document.querySelectorAll(`a[id^="GridView1_ctl"]`)].map(x => x.getAttribute('id')).map(x => `#${x}`))
  for (let linkId of linkIds) {
    await page.click(linkId);
    await page.waitForSelector(`#Panel1`);
    let data = await page.evaluate(() => {
      let result = {}
      document.querySelectorAll(`[id^="LA"]`).forEach(x => {
        let key = x.getAttribute('id').replace('LA_', '').toLowerCase()
        // remove last ,
        let value = x.innerText
        try {
          value = value.replace(/,$/, '')
        }
        catch (e) {
          console.log(value, e)
        }
        result[key] = value
      })
      let files = []
      document.querySelectorAll(`[id^="FileList"]`).forEach(x => {
        let fileRows = x.querySelectorAll('tr')
        fileRows.forEach(row => {
          let columns = row.querySelectorAll('td')
          if (columns.length === 0) return
          files.push({
            name: columns[1].innerText,
            link: `https://nccmember.ncc.gov.tw/Application/Fun/${columns[3].querySelector('a').getAttribute('href')}`,
          })
        })
      })

      return { ...result, files }
    })

    // parse verifydate
    let verifydate = data.verifydate
    let verifydateMatch = verifydate.match(/(\d{3})(\d{2})(\d{2})/)
    if (verifydateMatch) {
      data.verifydate_raw = verifydate
      data.verifydate = `${parseInt(verifydateMatch[1]) + 1911}/${verifydateMatch[2]}/${verifydateMatch[3]}`
    }
    result.push(data)
    console.log(`🕷\t${result.length}/${linkIds.length}`)
    await page.click(`[type="submit"]`)
    await page.waitForSelector(`#GridView1`);
  }
  fs.mkdirSync('dist', { recursive: true })
  fs.writeFileSync('dist/index.json', JSON.stringify(result))
  console.log('🎉\tdone')
  await browser.close();
})();