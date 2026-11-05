// Drop-in replacement for `next/link` so LeadGen pages run on React Router.
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { mapPath } from './next-navigation';

type Props = React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; replace?: boolean };

export default function Link({ href, prefetch: _p, replace, children, ...rest }: Props) {
  const external = /^(https?:|mailto:|tel:|#)/.test(href) || rest.target === '_blank';
  if (external) return <a href={href} {...rest}>{children}</a>;
  return <RouterLink to={mapPath(href)} replace={replace} {...rest}>{children}</RouterLink>;
}
