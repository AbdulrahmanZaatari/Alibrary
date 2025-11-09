export const metadata = {
  title: 'Islamic Research - Kindle Mode',
  description: 'Lightweight reader for Kindle browsers',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
};

export default function KindleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <style>{`
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          
          body {
            font-family: Georgia, 'Times New Roman', serif;
            background: #ffffff;
            color: #000000;
            line-height: 1.6;
            -webkit-text-size-adjust: 100%;
          }
          
          button:active {
            opacity: 0.7;
          }
          
          input[type="file"] {
            max-width: 100%;
          }
          
          /* Scrollbar styling for Kindle */
          ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          
          ::-webkit-scrollbar-track {
            background: #f1f1f1;
          }
          
          ::-webkit-scrollbar-thumb {
            background: #888;
            border-radius: 4px;
          }
          
          ::-webkit-scrollbar-thumb:hover {
            background: #555;
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}