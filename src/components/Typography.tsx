import React from 'react';

type TypographyProps = {
  variant?: 'h1' | 'body' | 'caption';
  children: React.ReactNode;
};

export function Typography({ variant = 'body', children }: TypographyProps) {
  if (variant === 'h1') {
    return <h1 className="text-2xl font-bold text-gray-900 mb-4">{children}</h1>;
  }
  
  if (variant === 'caption') {
    return <p className="text-sm text-gray-500">{children}</p>;
  }

  return <p className="text-gray-600 mb-6">{children}</p>;
}
