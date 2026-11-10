import { describe, it, expect } from 'vitest';
import {
  parsePrice,
  createProductListing,
  VERIFICATION_STATUS,
} from '../../src/services/extraction/baseExtractor.js';
import { extractFromCromaHtml } from '../../src/services/extraction/cromaAdapter.js';

describe('Product Extraction Service', () => {
  it('parses currency and price formats correctly', () => {
    expect(parsePrice('₹6,990')).toBe(6990);
    expect(parsePrice('Rs. 14,990.50')).toBe(14990.5);
    expect(parsePrice('₹ 1,24,999')).toBe(124999);
    expect(parsePrice(7599)).toBe(7599);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice('N/A')).toBeNull();
    expect(parsePrice(-100)).toBeNull();
  });

  it('handles missing information by representing it as null', () => {
    const listing = createProductListing({
      title: 'Logitech MX Master 3S',
      price: '8995',
      // specifications, seller, shippingCharge omitted
    });

    expect(listing.specifications).toBeNull();
    expect(listing.seller).toBeNull();
    expect(listing.shippingCharge).toBeNull();
    expect(listing.discountAmount).toBeNull();
    expect(listing.price).toBe(8995);
    expect(listing.currency).toBe('INR');
  });

  it('calculates discount correctly when MRP is available and higher', () => {
    const listing = createProductListing({
      title: 'Sony WH-CH720N',
      price: '6990',
      originalPrice: '14990',
    });

    expect(listing.price).toBe(6990);
    expect(listing.originalPrice).toBe(14990);
    expect(listing.discountAmount).toBe(8000);
  });

  it('extracts structured product data from Croma Schema.org JSON-LD fixture', async () => {
    const fixtureHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": "SONY WH-CH720N Bluetooth Headphone (Black)",
            "brand": { "@type": "Brand", "name": "Sony" },
            "sku": "270320",
            "offers": {
              "@type": "Offer",
              "priceCurrency": "INR",
              "price": "6990.00",
              "availability": "https://schema.org/InStock"
            }
          }
          </script>
        </head>
        <body>
          <h1>SONY WH-CH720N</h1>
        </body>
      </html>
    `;

    const res = await extractFromCromaHtml(fixtureHtml, 'https://www.croma.com/p/270320');
    expect(res.success).toBe(true);
    expect(res.listing.title).toBe('SONY WH-CH720N Bluetooth Headphone (Black)');
    expect(res.listing.price).toBe(6990);
    expect(res.listing.brand).toBe('Sony');
    expect(res.listing.verificationStatus).toBe(VERIFICATION_STATUS.VERIFIED_PAGE);
    expect(res.listing.availability).toBe('In Stock');
  });
});
