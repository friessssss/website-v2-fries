import Bounded from "@/components/Bounded";
import Heading from "@/components/Heading";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

/**
 * Props for `ProjectList`.
 */
export type ProjectListProps = SliceComponentProps<Content.ProjectListSlice>;

/**
 * Component for "ProjectList" Slices.
 */
const ProjectList = ({ slice }: ProjectListProps): JSX.Element => {
  return (
    <Bounded
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
    >
      <Heading as="h2" size="xl">
        {slice.primary.heading}
      </Heading>

      <div className="prose prose-lg prose-invert mt-4 text-slate-100">
        {slice.primary.description}
      </div>

      {slice.items.map((item, index) => (
        <div key={index} className="ml-6 mt-8 max-w-prose md:ml-12 md:mt-16">
          <Heading as="h2" size="md">
            {item.name}
          </Heading>
        
          <div className="mt-1 flex w-fit items-center gap-1 text-2xl font-semibold tracking-tight text-slate-400">
            <span className="block bg-gradient-to-tr from-yellow-500 via-yellow-200 to-yellow-500 
            bg-clip-text text-2xl font-bold uppercase tracking-[.2em] text-transparent md:text-4xl align-middle">{item.field}</span>{" "}
            <span className="text-3xl font-extralight">/</span>{" "}
            <span>{item.description}</span>
          </div>
        </div>
      ))}

    </Bounded>
  );
};

export default ProjectList;
