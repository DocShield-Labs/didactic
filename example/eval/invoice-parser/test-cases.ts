/**
 * Test cases for invoice parser evaluation
 */

export interface InvoiceInput {
  ocrText: string;
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  invoiceNumber: string;
  vendor: string;
  invoiceDate: string;
  dueDate: string;
  customerName: string;
  lineItems: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentTerms: string;
}

export const testCases = [
  {
    input: {
      ocrText: `
INVOICE

ACME SOFTWARE INC.
456 Tech Blvd, Austin TX 78701
Invoice #: INV-2024-0042
Date: January 15, 2024
Due: February 15, 2024

Bill To:
Contoso Corporation
123 Business St
San Francisco, CA

Item                          Qty    Price      Total
Enterprise License            1      $5,000     $5,000
Premium Support (Annual)      1      $1,200     $1,200
API Overages                  2500   $0.02      $50

                              Subtotal:         $6,250
                              Tax (8.5%):       $531.25
                              TOTAL:            $6,781.25

Payment Terms: Net 30
      `,
    },
    expected: {
      invoiceNumber: 'INV-2024-0042',
      vendor: 'ACME SOFTWARE INC',
      invoiceDate: '2024-01-15',
      dueDate: '2024-02-15',
      customerName: 'Contoso Corporation',
      lineItems: [
        { description: 'Enterprise License', quantity: 1, unitPrice: 5000, total: 5000 },
        { description: 'Premium Support (Annual)', quantity: 1, unitPrice: 1200, total: 1200 },
        { description: 'API Overages', quantity: 2500, unitPrice: 0.02, total: 50 },
      ],
      subtotal: 6250,
      tax: 531.25,
      total: 6781.25,
      paymentTerms: 'Net 30',
    },
  },
  {
    input: {
      ocrText: `
INVOICE #INV-2024-0043

CloudHost Services Inc.
1000 Server Lane
Denver, CO 80201

Date: 01/20/2024
Due Date: 02/20/2024

BILL TO: TechStart Inc.

DESCRIPTION                   QTY    RATE       AMOUNT
Cloud Hosting - Monthly       1      $299.99    $299.99

                              Subtotal:  $299.99
                              Tax:       $25.50
                              Total:     $325.49

Terms: Net 30
      `,
    },
    expected: {
      invoiceNumber: 'INV-2024-0043',
      vendor: 'CloudHost Services',
      invoiceDate: '2024-01-20',
      dueDate: '2024-02-20',
      customerName: 'TechStart Inc',
      lineItems: [
        { description: 'Cloud Hosting', quantity: 1, unitPrice: 299.99, total: 299.99 },
      ],
      subtotal: 299.99,
      tax: 25.50,
      total: 325.49,
      paymentTerms: 'Net 30',
    },
  },
  {
    input: {
      ocrText: `
Office Supplies Co.
INVOICE

Invoice Number: INV-2024-0044
Invoice Date: January 25, 2024
Payment Due: February 25, 2024

Customer: Startup Labs

Item Description         Quantity    Unit Price    Line Total
Standing Desks           3           $800.00       $2,400.00
Ergonomic Chairs         5           $450.00       $2,250.00
Monitor Stands           8           $75.00        $600.00

                         Subtotal:                  $5,250.00
                         Sales Tax (8.5%):          $446.25
                         Total Due:                 $5,696.25

Payment Terms: Net 45
      `,
    },
    expected: {
      invoiceNumber: 'INV-2024-0044',
      vendor: 'Office Supplies Co',
      invoiceDate: '2024-01-25',
      dueDate: '2024-02-25',
      customerName: 'Startup Labs',
      lineItems: [
        { description: 'Ergonomic Chairs', quantity: 5, unitPrice: 450, total: 2250 },
        { description: 'Standing Desks', quantity: 3, unitPrice: 800, total: 2400 },
        { description: 'Monitor Stands', quantity: 8, unitPrice: 75, total: 600 },
      ],
      subtotal: 5250,
      tax: 446.25,
      total: 5696.25,
      paymentTerms: 'Net 45',
    },
  },
];

