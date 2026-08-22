import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0 touch:[&_svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // Every size has a `touch:` step. The root font is 15px, so the sizes
      // land a little under their names: `h-8` is 30px, `h-10` is 37.5px.
      // With a mouse the row is dense — this is a tool you keep open beside a
      // document. With a fingertip nothing you press is under ~34px, and the
      // controls that carry the document (the header row, dialogs) are ~38px.
      size: {
        default: 'h-8 touch:h-10 px-3 py-1.5',
        sm: 'h-7 touch:h-9 rounded-md px-2.5 text-xs',
        lg: 'h-9 touch:h-11 rounded-md px-6',
        icon: 'h-8 w-8 touch:h-10 touch:w-10',
        // The header row. Below `lg` these buttons carry no label, and a
        // width that is only padding plus a glyph leaves them narrower than
        // they are tall — a standing rectangle beside the square icon
        // buttons. The floor is the row height, so an icon-only one comes out
        // square; anything with a label grows past it on its own.
        chrome: 'h-8 min-w-8 touch:h-10 touch:min-w-10 rounded-md px-2 lg:px-2.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
