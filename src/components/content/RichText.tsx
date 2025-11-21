import clsx from "clsx";
import { PortableText, type PortableTextComponents } from "@portabletext/react";
import type { PortableTextBlock } from "sanity";

const components: PortableTextComponents = {
  block: {
    normal: ({ children }) => <p className="leading-relaxed">{children}</p>,
  },
  marks: {
    link: ({ children, value }) => {
      return (
        <a
          href={value?.href}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted underline-offset-4 transition hover:decoration-solid"
        >
          {children}
        </a>
      );
    },
  },
};

type RichTextProps = {
  value?: PortableTextBlock[];
  className?: string;
  size?: "base" | "large";
};

export default function RichText({
  value,
  className,
  size = "base",
}: RichTextProps) {
  if (!value?.length) {
    return null;
  }

  const sizeClasses =
    size === "large"
      ? "text-lg leading-relaxed md:text-xl"
      : "text-base leading-relaxed";

  return (
    <div className={clsx("space-y-4", className, sizeClasses)}>
      <PortableText value={value} components={components} />
    </div>
  );
}

