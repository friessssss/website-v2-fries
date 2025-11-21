import { createClient, type QueryParams } from "next-sanity";
import imageUrlBuilder from "@sanity/image-url";
import type { Image } from "sanity";

const projectId =
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ??
  process.env.SANITY_PROJECT_ID ??
  "";

const dataset =
  process.env.NEXT_PUBLIC_SANITY_DATASET ??
  process.env.SANITY_DATASET ??
  "";

const apiVersion =
  process.env.NEXT_PUBLIC_SANITY_API_VERSION ??
  process.env.SANITY_API_VERSION ??
  "2024-06-01";

const useCdn = process.env.NODE_ENV === "production";

const client =
  projectId && dataset
    ? createClient({
        projectId,
        dataset,
        apiVersion,
        useCdn,
        perspective: "published",
      })
    : null;

const builder =
  projectId && dataset ? imageUrlBuilder({ projectId, dataset }) : null;

export function urlForImage(source: Image | null | undefined, width = 1600) {
  if (!builder || !source) {
    return undefined;
  }

  try {
    return builder.image(source).width(width).auto("format").url();
  } catch (error) {
    console.warn("[sanity] Failed to build image url", error);
    return undefined;
  }
}

export async function sanityFetch<T>(
  query: string,
  params: QueryParams = {},
) {
  if (!client) {
    return null;
  }

  return client.fetch<T>(query, params, {
    cache: "no-store",
  });
}

