import Avatar from "@/components/Avatar";
import Bounded from "@/components/Bounded";
import Button from "@/components/Button";
import Heading from "@/components/Heading";
import { Content } from "@prismicio/client";

import { PrismicRichText, SliceComponentProps } from "@prismicio/react";
import Shapes from "../Hero/Shapes";

/**
 * Props for `Biography`.
 */
export type BiographyProps = SliceComponentProps<Content.BiographySlice>;

/**
 * Component for "Biography" Slices.
 */
const Biography = ({ slice }: BiographyProps): JSX.Element => {
  return (
    <Bounded
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
    >
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-5">
        <Heading size="xl" className="col-start-1 col-span-2 md:row-start-1 md:col-span-3">
          {slice.primary.heading}
        </Heading>

        <div className="prose prose-xl prose-slate prose-invert col-span-3 md:row-start-2 text-slate-100 text-xl">
          <PrismicRichText field={slice.primary.description} />
        </div>
        <Button
          linkField={slice.primary.button_link}
          label={slice.primary.button_text}
          className="md:row-start-3"
        />

        <Avatar
          image={slice.primary.avatar}
          className="row-start-1 col-span-3 md:row-start-2 max-w-sm md:col-start-4 md:col-span-2"
        />
      </div>
    </Bounded>
  );
};

export default Biography;