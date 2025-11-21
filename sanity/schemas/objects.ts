import { defineField, defineType } from "sanity";

export const navLink = defineType({
  name: "navLink",
  title: "Navigation Link",
  type: "object",
  fields: [
    defineField({
      name: "label",
      title: "Label",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "href",
      title: "URL or Path",
      type: "string",
      description: "Relative path or absolute URL",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "variant",
      title: "Variant",
      type: "string",
      options: {
        list: [
          { title: "Default", value: "default" },
          { title: "Primary", value: "primary" },
        ],
        layout: "radio",
      },
      initialValue: "default",
    }),
  ],
});

export const cta = defineType({
  name: "cta",
  title: "CTA",
  type: "object",
  fields: [
    defineField({
      name: "label",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "href",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "style",
      title: "Style",
      type: "string",
      options: {
        list: [
          { title: "Solid", value: "solid" },
          { title: "Outline", value: "outline" },
          { title: "Ghost", value: "ghost" },
        ],
        layout: "radio",
      },
      initialValue: "solid",
    }),
  ],
});

export const stat = defineType({
  name: "stat",
  title: "Stat",
  type: "object",
  fields: [
    defineField({
      name: "label",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "value",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "detail",
      type: "string",
    }),
  ],
});

export const experienceEntry = defineType({
  name: "experienceEntry",
  title: "Experience Entry",
  type: "object",
  fields: [
    defineField({
      name: "role",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "company",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "range",
      title: "Date Range",
      type: "string",
    }),
    defineField({
      name: "summary",
      type: "text",
    }),
    defineField({
      name: "highlights",
      type: "array",
      of: [{ type: "string" }],
    }),
  ],
});

export const projectCard = defineType({
  name: "projectCard",
  title: "Project Card",
  type: "object",
  fields: [
    defineField({
      name: "name",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug / ID",
      type: "string",
      description: "Used for anchors or analytics labels",
    }),
    defineField({
      name: "summary",
      type: "text",
      rows: 3,
    }),
    defineField({
      name: "tech",
      title: "Tech Stack",
      type: "array",
      of: [{ type: "string" }],
    }),
    defineField({
      name: "cta",
      title: "Primary CTA",
      type: "cta",
    }),
    defineField({
      name: "secondaryLink",
      title: "Secondary Link",
      type: "cta",
    }),
    defineField({
      name: "status",
      type: "string",
      options: {
        list: [
          { title: "Live", value: "live" },
          { title: "In Progress", value: "wip" },
          { title: "Experiment", value: "experiment" },
        ],
      },
      initialValue: "live",
    }),
  ],
});

export const playlistPick = defineType({
  name: "playlistPick",
  title: "Playlist Pick",
  type: "object",
  fields: [
    defineField({
      name: "title",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "description",
      type: "string",
    }),
    defineField({
      name: "spotifyUrl",
      type: "url",
      validation: (rule) => rule.uri({
        scheme: ["http", "https"],
      }),
    }),
  ],
});

const sharedObjects = [
  navLink,
  cta,
  stat,
  experienceEntry,
  projectCard,
  playlistPick,
];

export default sharedObjects;

