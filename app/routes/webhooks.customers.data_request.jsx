import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received GDPR ${topic} webhook for ${shop}`);
  // GDPR customer data request - our app does not store customer personal data, so we return 200 OK
  return new Response();
};
