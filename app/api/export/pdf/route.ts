import { NextRequest, NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';
import amiriFont from '@/lib/fonts/Amiri-Regular-normal.js';

export async function POST(request: NextRequest) {
  try {
    const { sessionName, bookTitle, messages, mode } = await request.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages to export' }, { status: 400 });
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
    });

    // ✅ Register Amiri font for Arabic support
    doc.addFileToVFS('Amiri-Regular.ttf', amiriFont);
    doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
    doc.setFont('Amiri');

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const leftMargin = 60;
    const rightMargin = pageWidth - 60;
    const maxWidth = pageWidth - 120;
    let y = 40;

    // ✅ Helper to detect Arabic text
    const isArabicText = (text: string) => /[\u0600-\u06FF]/.test(text);

    // ✅ Helper to split text into lines
    const splitTextToLines = (text: string, fontSize: number) => {
      doc.setFontSize(fontSize);
      const words = text.split(' ');
      const lines: string[] = [];
      let currentLine = '';

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const width = doc.getTextWidth(testLine);

        if (width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    };

    // ✅ Helper to add new page if needed
    const checkPageBreak = (requiredSpace: number) => {
      if (y + requiredSpace > pageHeight - 40) {
        doc.addPage();
        doc.setFont('Amiri');
        y = 40;
        return true;
      }
      return false;
    };

    // ✅ HEADER
    doc.setFontSize(18);
    const headerText = sessionName || bookTitle || 'Chat Export';
    const headerIsArabic = isArabicText(headerText);
    doc.text(headerText, headerIsArabic ? rightMargin : leftMargin, y, { 
      align: headerIsArabic ? 'right' : 'left' 
    });
    y += 30;

    // ✅ METADATA
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    
    if (mode) {
      doc.text(`Mode: ${mode}`, rightMargin, y, { align: 'right' });
      y += 16;
    }
    
    if (bookTitle) {
      const bookIsArabic = isArabicText(bookTitle);
      doc.text(`Book: ${bookTitle}`, bookIsArabic ? rightMargin : leftMargin, y, { 
        align: bookIsArabic ? 'right' : 'left' 
      });
      y += 16;
    }
    
    doc.text(`Messages: ${messages.length}`, rightMargin, y, { align: 'right' });
    y += 16;
    
    doc.text(`Exported: ${new Date().toLocaleString()}`, rightMargin, y, { align: 'right' });
    y += 30;

    // ✅ Separator
    doc.setDrawColor(200, 200, 200);
    doc.line(leftMargin, y, rightMargin, y);
    y += 20;

    // ✅ PROCESS MESSAGES
    messages.forEach((msg: any) => {
      checkPageBreak(60);

      // Role Label
      doc.setFontSize(12);
      doc.setTextColor(msg.role === 'user' ? 30 : 0, msg.role === 'user' ? 136 : 150, msg.role === 'user' ? 229 : 136);
      
      const label = msg.role === 'user' ? '👤 User:' : '🤖 Assistant:';
      doc.text(label, leftMargin, y);
      y += 18;

      // Message Content
      doc.setFontSize(11);
      doc.setTextColor(34, 34, 34);

      // Clean markdown formatting
      const cleanText = msg.content
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .replace(/#{1,6}\s/g, '');

      const paragraphs = cleanText.split('\n').filter((p: string) => p.trim());

      paragraphs.forEach((paragraph: string) => {
        // Handle bullet points
        const isBullet = /^\s*[-*•]\s+/.test(paragraph);
        if (isBullet) {
          paragraph = '• ' + paragraph.replace(/^\s*[-*•]\s+/, '');
        }

        const isArabic = isArabicText(paragraph);
        const align = isArabic ? 'right' : 'left';
        const x = isArabic ? rightMargin : leftMargin;

        const lines = splitTextToLines(paragraph, 11);

        lines.forEach((line: string) => {
          checkPageBreak(16);
          doc.text(line, x, y, { align });
          y += 14;
        });

        y += 4; // Space between paragraphs
      });

      // ✅ METADATA (Page, Documents, etc.)
      const metadata: string[] = [];

      if (msg.book_page) {
        metadata.push(`📖 Page ${msg.book_page}`);
      }

      if (msg.document_names) {
        try {
          const docNames = typeof msg.document_names === 'string' 
            ? JSON.parse(msg.document_names) 
            : msg.document_names;
          
          if (docNames && docNames.length > 0) {
            metadata.push(`📚 Documents: ${docNames.join(', ')}`);
          }
        } catch {}
      }

      if (msg.custom_prompt_name) {
        metadata.push(`✨ Prompt: ${msg.custom_prompt_name}`);
      }

      if (metadata.length > 0) {
        checkPageBreak(metadata.length * 14);
        doc.setFontSize(9);
        doc.setTextColor(109, 40, 217);
        
        metadata.forEach((meta) => {
          const metaIsArabic = isArabicText(meta);
          doc.text(meta, metaIsArabic ? rightMargin : leftMargin, y, { 
            align: metaIsArabic ? 'right' : 'left',
            maxWidth 
          });
          y += 12;
        });
        y += 4;
      }

      // Timestamp
      checkPageBreak(14);
      doc.setFontSize(9);
      doc.setTextColor(136, 136, 136);
      doc.text(new Date(msg.created_at).toLocaleString(), rightMargin, y, { align: 'right' });
      y += 18;

      // Separator
      checkPageBreak(12);
      doc.setDrawColor(220, 220, 220);
      doc.line(leftMargin, y, rightMargin, y);
      y += 14;
      doc.setTextColor(0, 0, 0); // Reset color
    });

    // ✅ Generate PDF
    const pdfBlob = doc.output('arraybuffer');
    const pdfBuffer = Buffer.from(pdfBlob);

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="chat-export-${Date.now()}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF export error:', error);
    return NextResponse.json({ 
      error: 'Export failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}