import React from 'react';

export function CenterLayout(props: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-center">
      <div className="max-w-md w-full">
        {props.children}
      </div>
    </div>
  );
}
