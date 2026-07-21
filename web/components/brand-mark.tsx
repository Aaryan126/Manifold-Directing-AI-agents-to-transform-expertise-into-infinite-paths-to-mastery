type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className = "" }: BrandMarkProps) {
  return (
    <span className={`manifoldBrandMark ${className}`.trim()} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
