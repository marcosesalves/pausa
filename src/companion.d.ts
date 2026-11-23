import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "pausa-companion": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        state?: string;
        size?: number | string;
        stage?: number | string;
        pattern?: string;
        react?: string;
      };
    }
  }
}
