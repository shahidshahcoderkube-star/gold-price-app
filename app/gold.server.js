import prisma from "./db.server";

// Conversion factor: 1 Troy Ounce = 31.1034768 Grams
const OUNCE_TO_GRAM = 31.1034768;

/**
 * Fetches the live gold price from Metals.dev and converts it to price per gram.
 * Returns an object with rate24K, rate22K, and rate18K per gram.
 */
export async function fetchGoldRates(settings = {}) {
  // Developer's global API Key for Metals.dev
  const apiKey = "HGGUMKYGD3OXYMLYKTTM686LYKTTM";
  const currency = settings.currency || "USD";

  const response = await fetch(
    `https://api.metals.dev/v1/latest?api_key=${apiKey}&currency=${currency}&unit=toz`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Metals.dev API failed: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  let ratePerOunce = 0;
  if (data && data.metals) {
    ratePerOunce = data.metals.gold;
  } else if (data && data.rates) {
    // Fallback if rates is provided instead of metals object
    const currencyXAU = `${currency}XAU`;
    ratePerOunce = data.rates[currencyXAU] || (data.rates.XAU ? 1 / data.rates.XAU : 0);
  }

  if (!ratePerOunce || isNaN(ratePerOunce)) {
    throw new Error(`Invalid gold rate fetched from Metals.dev API. Response keys: ${Object.keys(data || {})}`);
  }

  // Convert price per Ounce to price per Gram
  const rate24K = ratePerOunce / OUNCE_TO_GRAM;

  // Calculate 22K and 18K based on 24K purity proportions
  const rate22K = rate24K * (22 / 24);
  const rate18K = rate24K * (18 / 24);

  return {
    rate24K: Math.round(rate24K * 100) / 100,
    rate22K: Math.round(rate22K * 100) / 100,
    rate18K: Math.round(rate18K * 100) / 100,
  };
}

/**
 * Applies Minimum Rate Protection (Stop-Loss) to the live rates.
 * Returns the effective rates to be used in calculations.
 */
export function getEffectiveRates(liveRates, settings) {
  const effective24K = Math.max(liveRates.rate24K, settings.minRate24K || 0);
  const effective22K = Math.max(liveRates.rate22K, settings.minRate22K || 0);
  const effective18K = Math.max(liveRates.rate18K, settings.minRate18K || 0);

  return {
    rate24K: effective24K,
    rate22K: effective22K,
    rate18K: effective18K,
    isUsingFloor24K: liveRates.rate24K < (settings.minRate24K || 0),
    isUsingFloor22K: liveRates.rate22K < (settings.minRate22K || 0),
    isUsingFloor18K: liveRates.rate18K < (settings.minRate18K || 0),
  };
}

/**
 * Calculates the final price of a product using the formula:
 * Final Price = Gold Cost + Making Charges + Profit Margin
 */
export function calculateProductPrice(weight, karat, effectiveRates, settings) {
  // Select correct gold rate based on karat
  let rate = 0;
  if (karat === "24K") {
    rate = effectiveRates.rate24K;
  } else if (karat === "22K") {
    rate = effectiveRates.rate22K;
  } else if (karat === "18K") {
    rate = effectiveRates.rate18K;
  } else {
    throw new Error(`Unsupported karat type: ${karat}`);
  }

  const goldCost = rate * weight;

  // Calculate making charges
  let makingCharges = 0;
  if (settings.makingChargeType === "percentage") {
    makingCharges = goldCost * (settings.makingChargeValue / 100);
  } else {
    makingCharges = settings.makingChargeValue; // flat rate
  }

  // Cost basis before profit margin
  const costBasis = goldCost + makingCharges;

  // Calculate profit margin
  let profitMargin = 0;
  if (settings.profitMarginType === "percentage") {
    profitMargin = costBasis * (settings.profitMarginValue / 100);
  } else {
    profitMargin = settings.profitMarginValue; // flat rate
  }

  const finalPrice = costBasis + profitMargin;

  // Round to 2 decimal places
  return Math.round(finalPrice * 100) / 100;
}
