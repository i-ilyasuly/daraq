import React from 'react';

export function Card(props: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-8">
      {props.children}
    </div>
  );
}
