import { defineField, defineType } from "sanity";

const siteSettings = defineType({
  name: "siteSettings",
  title: "Site Settings",
  type: "document",
  fields: [
    defineField({
      name: "siteTitle",
      title: "Site Title",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "siteDescription",
      title: "Site Description",
      type: "text",
      rows: 3,
    }),
    defineField({
      name: "contactEmail",
      title: "Contact Email",
      type: "string",
    }),
    defineField({
      name: "navLinks",
      title: "Navigation Links",
      type: "array",
      of: [{ type: "navLink" }],
    }),
    defineField({
      name: "footerLinks",
      title: "Footer Links",
      type: "array",
      of: [{ type: "navLink" }],
    }),
    defineField({
      name: "ogImage",
      title: "Meta / OG Image",
      type: "image",
      options: {
        hotspot: true,
      },
    }),
    defineField({
      name: "metaKeywords",
      title: "Meta Keywords",
      type: "array",
      of: [{ type: "string" }],
    }),
    defineField({
      name: "fancyAccent",
      title: "Fancy Accent Color",
      type: "string",
      description: "Hex value used to seed the fancy palette",
      initialValue: "#ff4d4d",
    }),
    defineField({
      name: "simpleAccent",
      title: "Simple Accent Color",
      type: "string",
      description: "Hex value for the simple palette",
      initialValue: "#2563eb",
    }),
  ],
});

export default siteSettings;

