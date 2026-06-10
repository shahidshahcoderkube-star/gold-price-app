import { calculateProductPrice } from "./gold.server";

// GraphQL query to fetch products along with weight and karat metafields at both product and variant levels
const GET_PRODUCTS_QUERY = `#graphql
  query getProductsWithGoldMetafields($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          featuredImage {
            url
          }
          goldKarat: metafield(namespace: "custom", key: "gold_karat") {
            value
          }
          goldWeight: metafield(namespace: "custom", key: "gold_weight") {
            value
          }
          variants(first: 50) {
            edges {
              node {
                id
                title
                price
                sku
                goldKarat: metafield(namespace: "custom", key: "gold_karat") {
                  value
                }
                goldWeight: metafield(namespace: "custom", key: "gold_weight") {
                  value
                }
              }
            }
          }
        }
      }
    }
  }
`;

// GraphQL mutation to bulk update prices of variants within a product
const BULK_UPDATE_VARIANTS_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Fetches all products that have gold weight and karat metadata configured.
 */
export async function fetchGoldProducts(admin) {
  let hasNextPage = true;
  let cursor = null;
  const goldProducts = [];

  while (hasNextPage) {
    const response = await admin.graphql(GET_PRODUCTS_QUERY, {
      variables: {
        first: 50,
        after: cursor,
      },
    });

    const responseJson = await response.json();
    const productsData = responseJson.data?.products;

    if (!productsData) break;

    for (const edge of productsData.edges) {
      const product = edge.node;

      // Extract product-level metadata
      const productKarat = product.goldKarat?.value;
      const productWeight = product.goldWeight ? parseFloat(product.goldWeight.value) : null;

      const validVariants = [];

      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;

        // Variant-level values override product-level values
        const variantKarat = variant.goldKarat?.value || productKarat;
        const variantWeight = variant.goldWeight ? parseFloat(variant.goldWeight.value) : productWeight;

        // Only include if we have both weight and karat
        if (variantWeight && variantKarat && ["18K", "22K", "24K"].includes(variantKarat)) {
          validVariants.push({
            id: variant.id,
            title: variant.title,
            currentPrice: parseFloat(variant.price) || 0,
            sku: variant.sku || "",
            weight: variantWeight,
            karat: variantKarat,
          });
        }
      }

      if (validVariants.length > 0) {
        goldProducts.push({
          id: product.id,
          title: product.title,
          imageUrl: product.featuredImage?.url || "",
          karat: productKarat || validVariants[0].karat, // Default display karat
          weight: productWeight || validVariants[0].weight, // Default display weight
          variants: validVariants,
        });
      }
    }

    hasNextPage = productsData.pageInfo.hasNextPage;
    cursor = productsData.pageInfo.endCursor;
  }

  return goldProducts;
}

/**
 * Recalculates prices and pushes updates to Shopify.
 * If targetProductIds is provided, it only syncs those specific products (Selective Push).
 * Otherwise, it syncs all products (Bulk Push).
 */
export async function syncProductPrices(admin, settings, effectiveRates, targetProductIds = null) {
  // Fetch all qualifying gold products
  const products = await fetchGoldProducts(admin);
  
  // Filter products if targetProductIds is provided (Selective Sync)
  const productsToSync = targetProductIds 
    ? products.filter(p => targetProductIds.includes(p.id))
    : products;

  let updatedCount = 0;

  for (const product of productsToSync) {
    const variantsToUpdate = [];

    for (const variant of product.variants) {
      try {
        const calculatedPrice = calculateProductPrice(
          variant.weight,
          variant.karat,
          effectiveRates,
          settings
        );

        // Check Safety Lock: Block Price Decreases
        if (settings.blockPriceDecreases && calculatedPrice < variant.currentPrice) {
          // Skip updating this variant since new price is lower
          continue;
        }

        // Only update if the price is actually changing
        if (calculatedPrice !== variant.currentPrice) {
          variantsToUpdate.push({
            id: variant.id,
            price: calculatedPrice.toString(),
          });
        }
      } catch (err) {
        console.error(`Error calculating price for variant ${variant.id}:`, err);
      }
    }

    // If there are variants to update, push them in a batch to Shopify
    if (variantsToUpdate.length > 0) {
      const response = await admin.graphql(BULK_UPDATE_VARIANTS_MUTATION, {
        variables: {
          productId: product.id,
          variants: variantsToUpdate,
        },
      });

      const responseJson = await response.json();
      const userErrors = responseJson.data?.productVariantsBulkUpdate?.userErrors || [];
      
      if (userErrors.length > 0) {
        console.error(`GraphQL errors updating product ${product.id}:`, userErrors);
      } else {
        updatedCount += variantsToUpdate.length;
      }
    }
  }

  return updatedCount;
}

const CREATE_METAFIELD_DEF_MUTATION = `#graphql
  mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const GET_METAFIELD_DEF_QUERY = `#graphql
  query GetMetafieldDefinition($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
    metafieldDefinitions(first: 1, ownerType: $ownerType, namespace: $namespace, key: $key) {
      edges {
        node {
          id
          pinned
        }
      }
    }
  }
`;

const PIN_METAFIELD_DEF_MUTATION = `#graphql
  mutation MetafieldDefinitionPin($definitionId: ID!) {
    metafieldDefinitionPin(definitionId: $definitionId) {
      pinnedDefinition {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_METAFIELD_DEF_MUTATION = `#graphql
  mutation UpdateMetafieldDefinition($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Automatically registers and pins the Product and Variant level gold weight and karat metafield definitions on install/startup.
 */
export async function ensureMetafieldDefinitions(admin) {
  const definitions = [
    {
      name: "Gold Weight",
      namespace: "custom",
      key: "gold_weight",
      ownerType: "PRODUCT",
      type: "number_decimal",
    },
    {
      name: "Gold Karat",
      namespace: "custom",
      key: "gold_karat",
      ownerType: "PRODUCT",
      type: "single_line_text_field",
      validations: [
        {
          name: "choices",
          value: JSON.stringify(["18K", "22K", "24K"]),
        },
      ],
    },
    {
      name: "Gold Weight",
      namespace: "custom",
      key: "gold_weight",
      ownerType: "PRODUCTVARIANT",
      type: "number_decimal",
    },
    {
      name: "Gold Karat",
      namespace: "custom",
      key: "gold_karat",
      ownerType: "PRODUCTVARIANT",
      type: "single_line_text_field",
      validations: [
        {
          name: "choices",
          value: JSON.stringify(["18K", "22K", "24K"]),
        },
      ],
    },
  ];

  for (const def of definitions) {
    try {
      let definitionId = null;

      // 1. Try to create the definition
      const response = await admin.graphql(CREATE_METAFIELD_DEF_MUTATION, {
        variables: {
          definition: def,
        },
      });
      const responseJson = await response.json();
      const createData = responseJson.data?.metafieldDefinitionCreate;
      
      if (createData?.createdDefinition) {
        definitionId = createData.createdDefinition.id;
        console.log(`Created metafield definition: ${def.ownerType}.${def.key} (${definitionId})`);
      } else {
        // Creation failed (likely because it already exists). Fetch the existing definition GID.
        const queryResponse = await admin.graphql(GET_METAFIELD_DEF_QUERY, {
          variables: {
            ownerType: def.ownerType,
            namespace: def.namespace,
            key: def.key,
          },
        });
        const queryJson = await queryResponse.json();
        const existingNode = queryJson.data?.metafieldDefinitions?.edges?.[0]?.node;
        if (existingNode) {
          definitionId = existingNode.id;
          console.log(`Found existing metafield definition: ${def.ownerType}.${def.key} (${definitionId})`);

          // Update validation choices for gold_karat
          if (def.key === "gold_karat") {
            const updateResponse = await admin.graphql(UPDATE_METAFIELD_DEF_MUTATION, {
              variables: {
                definition: {
                  id: definitionId,
                  validations: def.validations,
                },
              },
            });
            const updateJson = await updateResponse.json();
            const updateErrors = updateJson.data?.metafieldDefinitionUpdate?.userErrors || [];
            if (updateErrors.length > 0) {
              console.warn(`Note: Failed to update validation choices for ${def.ownerType}.${def.key}:`, updateErrors[0].message);
            } else {
              console.log(`Successfully updated validation choices for ${def.ownerType}.${def.key}`);
            }
          }
        }
      }

      // 2. Always attempt to pin the definition
      if (definitionId) {
        const pinResponse = await admin.graphql(PIN_METAFIELD_DEF_MUTATION, {
          variables: {
            definitionId,
          },
        });
        const pinJson = await pinResponse.json();
        const pinErrors = pinJson.data?.metafieldDefinitionPin?.userErrors || [];
        if (pinErrors.length > 0) {
          console.warn(`Note: Failed to pin metafield definition ${def.ownerType}.${def.key}:`, pinErrors[0].message);
        } else {
          console.log(`Successfully pinned metafield definition ${def.ownerType}.${def.key}`);
        }
      }
    } catch (err) {
      console.error(`Error registering/pinning metafield definition for ${def.ownerType}.${def.key}:`, err);
    }
  }
}


