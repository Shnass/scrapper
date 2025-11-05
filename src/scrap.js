import fs from 'fs';
import WebSocket, { WebSocketServer } from 'ws';
const token = process.env.TOKEN;
const RATELIMIT_THRESHOLD = 5;
const DELAY_NORMAL_MS = 100;
const DELAY_COOLDOWN_MS = 60_000;

let rateLimitRemaining = 60;
let releasesCounter = 0;
let currentListingLength = 0;
const exchangeRates = [];

export function getInventoryUrl(username) {
    return `https://api.discogs.com/users/${username}/inventory?token=${token}&per_page=100&sort=listed&sort_order=desc`;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function setRateLimitRemaining(remaining) {
    rateLimitRemaining = remaining;
}
async function rateLimitPrevent() {
    return wait(rateLimitRemaining < RATELIMIT_THRESHOLD ? DELAY_COOLDOWN_MS : DELAY_NORMAL_MS);
}

const releasesFileSrc = './src/releasesBySeller.json'
const sellers = await fs.promises.readFile('./src/sellersCache.json', 'utf-8')
    .then(data => JSON.parse(data))
    .catch(error => {
        console.log(error);
        return []
    })

//console.log(sellers);

const releasesBySeller = await fs.promises.readFile(releasesFileSrc, 'utf-8')
    .then(data => JSON.parse(data))
    .catch(error => {
        console.log(error)
        return []
    })

async function getItemPriceInUSD(listing_id, currency_code, currentPrice) {
    if (currency_code === 'USD') {
        return parseFloat(currentPrice.toFixed(2));
    }
    if (exchangeRates[currency_code]) {
        return parseFloat((currentPrice * exchangeRates[currency_code]).toFixed(2));
    }
    try{
        const response = await fetch(`https://api.discogs.com/marketplace/listings/${listing_id}?token=${token}&curr_abbr=USD`);
        const data = await response.json();

        exchangeRates[currency_code] = data.price.value / currentPrice;

        setRateLimitRemaining(response.headers.get('x-discogs-ratelimit-remaining'));
        await rateLimitPrevent();

        return parseFloat(data.price.value.toFixed(2));
    } catch (error) {
        console.error(`Error fetching price for listing ID ${listing_id}:`, error);
        return null;
    }
}

async function getReleaseDetailedData(id) {
    try {
    const releaseData = await fetch(`https://api.discogs.com/releases/${id}?token=${token}`);
    const releaseJson = await releaseData.json();

    setRateLimitRemaining(releaseData.headers.get('x-discogs-ratelimit-remaining'));
    await rateLimitPrevent();

    releasesCounter++;
    console.log(`releases fetched: ${releasesCounter}/${currentListingLength}`);

        return {
            label: releaseJson.labels.length > 0 ? releaseJson.labels[0].name : 'Unknown',
            genres: releaseJson.genres,
            styles: releaseJson.styles,
            format: releaseJson.formats.map(f => f.name).join(', '),
            forSale: releaseJson.num_for_sale,
            lowestPrice: releaseJson.lowest_price,
            have: releaseJson.community.have,
            want: releaseJson.community.want,
            videos: releaseJson.videos
        };
    } catch (error) {
        console.error(`Error fetching release data for ID ${id}:`, error);
        return {};  
    }
}

async function getReleases(listing) {
    const releases = [];
    for (const item of listing){
        if(item.status === 'For Sale'){
            const releaseDetailedData = await getReleaseDetailedData(item.release.id);
            const itemPrice = await getItemPriceInUSD(item.id, item.price.currency_code, item.price.value);
            const itemCurrency = itemPrice ? 'USD' : item.price.currency_code;
            const detailedRelease = {
                releaseId: item.release.id,
                title: item.release.title,
                condition: item.condition,
                price: itemPrice || item.price.value,
                sleeve: item.sleeve_condition,
                condition: item.condition,
                artist: item.release.artist,
                link: item.uri,
                ...releaseDetailedData
            }

            releases.push(detailedRelease);

        }
    }
    return releases;
}

async function scrapPage(url, currentPage) {
    try{
        const response = await fetch(`${url}&page=${currentPage}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const listings = await response.json();
        setRateLimitRemaining(response.headers.get('x-discogs-ratelimit-remaining'));
        await rateLimitPrevent();
    
        if(currentPage === 1){
            currentListingLength = listings.pagination.items;
            return {
                listings: await getReleases(listings.listings), 
                items: listings.pagination.items, 
                shipsFrom: listings.listings[0]?.ships_from, 
                sellerId: listings.listings[0]?.seller.id
            };
        }
        return await getReleases(listings.listings);
    } catch (error) {
        console.error(`Error fetching page ${currentPage} from ${url}:`, error);
        return currentPage === 1 ? {listings: [], items: 0, shipsFrom: null, sellerId: null} : [];
    }
}


async function getPolicies(sellerId) {
    const policies = await fetch(`https://api.discogs.com/v3/marketplace/shipping/policies?seller_id=${sellerId}&token=${token}&curr_abbr=USD`);
    const policiesData = await policies.json();
    return policiesData;
}
async function fetchSellersReleases(seller){
    const sellerName = seller.name || seller;
    const url = getInventoryUrl(sellerName);
    let currentPage = 1;
    const sellerReleases = [];

    const firstPageData = await scrapPage(url, currentPage);
    sellerReleases.push(...firstPageData.listings);
    const totalItems = firstPageData.items;
    const sellerLocation = firstPageData.shipsFrom;
    const totalPages = Math.ceil(totalItems / 100);
    const sellerId = firstPageData.sellerId;
    console.log(`Fetching releases for seller: ${sellerName}, Total Items: ${totalItems}, Total Pages: ${totalPages}`);
    const shippingPolicies = await getPolicies(sellerId);

    if(totalPages != currentPage){
        for(let i = currentPage + 1; i <= totalPages; i++){
            const pageData = await scrapPage(url, i);
            sellerReleases.push(...pageData);
        }
    }

    return {
        name: sellerName,
        releases: sellerReleases,
        location: sellerLocation,
        shippingPolicies: shippingPolicies
    };
}

const sellerRecords = await fetchSellersReleases('VoyagerVinyl');
const recommendedReleases = sellerRecords.releases.filter(r => {
    if (!r.price || !r.lowestPrice) return false;
    return r.have < r.want &&
           r.forSale < 10 &&
           r.price < (r.lowestPrice * 1.2) &&
           (r.genres.includes('Electronic') || r.genres.includes('Hip Hop')) &&
           r.format.toLowerCase().includes('vinyl');
})

console.log(recommendedReleases)

//console.log(await fetchSellersReleases('NabilBenHamama'));
//console.log(await checkIfHasFreeShipping('NabilBenHamama'));

//console.log(await getReleaseDetailedData(4776911));
//console.log(await getItemPriceInUSD(3843259483))

const wss = new WebSocketServer({ port: 8080 });
wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.send('Hello from server');
  ws.on('message', (msg) => console.log(`Received: ${msg}`));
});
