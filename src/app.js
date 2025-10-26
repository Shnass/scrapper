import { XMLParser} from "fast-xml-parser";
import fs from "fs";
const sellersCacheURL = './src/sellersCache.json';

const rssUrl = 'https://www.discogs.com/sell/mplistrss?output=rss&release_id='
const cachedSellers = await fs.promises.readFile(sellersCacheURL, 'utf-8')
    .then(data => {
        return JSON.parse(data)
    })
    .catch(() => []);
const sellersArray = [...cachedSellers];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getSellersNamesByReleaseId(releaseId) {
    return fetch(`${rssUrl}${releaseId}`)
    .then(response => response.text())
    .then(data => {
        const sellers = [];
        const newSellers = [];
        const parser = new XMLParser();
        const jsonObj = parser.parse(data);
        if(jsonObj.feed.entry) {
            jsonObj.feed.entry.forEach(entry => {
                const seller = entry.summary.split(' -')[1].trim();
                sellers.push(seller);
            })
            const uniqueSellers = [... new Set(sellers)];
            uniqueSellers.forEach(seller => {
                if(!sellersArray.find(s => s.name === seller)){
                    newSellers.push({ name: seller });
                }
            });
        }
        return newSellers;
    })
    .catch(error => console.error('Error fetching the RSS feed:', error));
}

for (let i = 1; i <= 1000; i++) {
    try{
        console.log(`Processing release ID: ${i}`);
        const releaseSellers = await getSellersNamesByReleaseId(i); 
        sellersArray.push(...releaseSellers);
        //await wait(1000);
    } catch (error) {
        console.error(`Error processing release ID ${i}:`, error);
    }
}

await fs.promises.writeFile(sellersCacheURL, JSON.stringify(sellersArray, null, 4));