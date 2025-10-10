
'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { collection, getDocs, query, where, Timestamp, doc } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { Member, Transaction, GroupSettings } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format, getYear, getMonth, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';

const reportSchema = z.object({
  reportType: z.enum(['monthly', 'yearly']),
  year: z.string().nonempty('Please select a year.'),
  month: z.string().optional(),
  format: z.enum(['pdf', 'excel']),
}).refine(data => {
    if (data.reportType === 'monthly') {
        return !!data.month;
    }
    return true;
}, {
    message: 'Month is required for monthly reports',
    path: ['month'],
});


export default function ReportsPage() {
    const { toast } = useToast();
    const { user } = useUser();
    const firestore = useFirestore();
    const [isLoading, setIsLoading] = useState(false);

    const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);
    const settingsRef = useMemoFirebase(() => user && firestore ? doc(firestore, `users/${user.uid}/groupSettings`, 'settings') : null, [user, firestore]);

    const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);
    const { data: settings, isLoading: settingsLoading } = useDoc<GroupSettings>(settingsRef);


    const form = useForm<z.infer<typeof reportSchema>>({
        resolver: zodResolver(reportSchema),
        defaultValues: {
            reportType: 'monthly',
            format: 'pdf',
        },
    });

    const reportType = form.watch('reportType');

    const generateReport = async (values: z.infer<typeof reportSchema>) => {
        if (!user || !firestore || !members || !settings) return;

        setIsLoading(true);

        try {
            const { reportType, year, month, format: fileFormat } = values;
            const selectedYear = parseInt(year);
            let startDate: Date;
            let endDate: Date;
            let reportTitle: string;

            if (reportType === 'monthly' && month) {
                const selectedMonth = parseInt(month);
                startDate = startOfMonth(new Date(selectedYear, selectedMonth));
                endDate = endOfMonth(new Date(selectedYear, selectedMonth));
                reportTitle = `Monthly Report: ${format(startDate, 'MMMM yyyy')}`;
            } else {
                startDate = startOfYear(new Date(selectedYear, 0));
                endDate = endOfYear(new Date(selectedYear, 0));
                reportTitle = `Yearly Report: ${year}`;
            }

            const transactionsQuery = query(
                collection(firestore, `users/${user.uid}/transactions`),
                where('date', '>=', format(startDate, 'yyyy-MM-dd')),
                where('date', '<=', format(endDate, 'yyyy-MM-dd'))
            );

            const querySnapshot = await getDocs(transactionsQuery);
            const transactions = querySnapshot.docs.map(doc => doc.data() as Transaction);
            
            if (transactions.length === 0) {
                toast({
                    variant: 'destructive',
                    title: 'No Data',
                    description: 'No transactions found for the selected period.',
                });
                return;
            }

            // Calculate summary
            const totalDeposits = transactions.filter(tx => tx.type === 'deposit').reduce((sum, tx) => sum + tx.amount, 0);
            const totalWithdrawals = transactions.filter(tx => tx.type === 'withdrawal').reduce((sum, tx) => sum + tx.amount, 0);
            const netChange = totalDeposits - totalWithdrawals;
            const endingFund = settings.totalFund;
            const startingFund = endingFund - netChange;
            
            const summary = {
                'Starting Fund': startingFund,
                'Total Deposits': totalDeposits,
                'Total Withdrawals': totalWithdrawals,
                'Net Change': netChange,
                'Ending Fund (Remaining Balance)': endingFund,
            };

            const dataForExport = transactions.map(tx => ({
                'Member Name': members.find(m => m.id === tx.memberId)?.name || 'Unknown',
                'Date': tx.date,
                'Type': tx.type,
                'Description': tx.description,
                'Amount': tx.amount,
            }));


            if (fileFormat === 'pdf') {
                const doc = new jsPDF();
                doc.text(reportTitle, 14, 16);

                // Add summary table
                autoTable(doc, {
                    body: Object.entries(summary).map(([key, value]) => [key, String(value.toFixed(2))]),
                    startY: 22,
                    theme: 'striped',
                    styles: { fontSize: 10 },
                    headStyles: { fillColor: [22, 163, 74] },
                });
                
                // Add main data table
                autoTable(doc, {
                    head: [['Member Name', 'Date', 'Type', 'Description', 'Amount']],
                    body: dataForExport.map(Object.values),
                    startY: (doc as any).lastAutoTable.finalY + 10,
                });

                doc.save(`report-${reportType}-${year}${month ? '-' + month : ''}.pdf`);
            } else if (fileFormat === 'excel') {
                const summarySheetData = Object.entries(summary).map(([key, value]) => ({ 'Metric': key, 'Amount (₹)': value }));
                const summaryWorksheet = XLSX.utils.json_to_sheet(summarySheetData);
                const dataWorksheet = XLSX.utils.json_to_sheet(dataForExport);
                
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
                XLSX.utils.book_append_sheet(workbook, dataWorksheet, 'Transactions');
                
                XLSX.writeFile(workbook, `report-${reportType}-${year}${month ? '-' + month : ''}.xlsx`);
            }
             toast({
                title: 'Report Generated',
                description: 'Your report has been successfully downloaded.',
            });

        } catch (error: any) {
            console.error("Failed to generate report:", error);
            toast({
                variant: 'destructive',
                title: 'Error generating report',
                description: error.message || 'An unexpected error occurred.',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const years = Array.from({ length: 10 }, (_, i) => getYear(new Date()) - i);
    const months = Array.from({ length: 12 }, (_, i) => ({
        value: String(i),
        label: format(new Date(0, i), 'MMMM'),
    }));

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold font-headline">Reports</h1>
            <Card className="max-w-2xl">
                <CardHeader>
                    <CardTitle>Export Transactions</CardTitle>
                    <CardDescription>Generate and download transaction reports in PDF or Excel format.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(generateReport)} className="space-y-8">
                            <FormField
                                control={form.control}
                                name="reportType"
                                render={({ field }) => (
                                    <FormItem className="space-y-3">
                                        <FormLabel>Report Type</FormLabel>
                                        <FormControl>
                                            <RadioGroup
                                                onValueChange={field.onChange}
                                                defaultValue={field.value}
                                                className="flex flex-col space-y-1"
                                            >
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="monthly" /></FormControl>
                                                    <FormLabel className="font-normal">Monthly</FormLabel>
                                                </FormItem>
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="yearly" /></FormControl>
                                                    <FormLabel className="font-normal">Yearly</FormLabel>
                                                </FormItem>
                                            </RadioGroup>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="flex gap-4">
                                <FormField
                                    control={form.control}
                                    name="year"
                                    render={({ field }) => (
                                        <FormItem className="flex-1">
                                            <FormLabel>Year</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl><SelectTrigger><SelectValue placeholder="Select a year" /></SelectTrigger></FormControl>
                                                <SelectContent>
                                                    {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                {reportType === 'monthly' && (
                                    <FormField
                                        control={form.control}
                                        name="month"
                                        render={({ field }) => (
                                            <FormItem className="flex-1">
                                                <FormLabel>Month</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl><SelectTrigger><SelectValue placeholder="Select a month" /></SelectTrigger></FormControl>
                                                    <SelectContent>
                                                        {months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </div>

                             <FormField
                                control={form.control}
                                name="format"
                                render={({ field }) => (
                                    <FormItem className="space-y-3">
                                        <FormLabel>File Format</FormLabel>
                                        <FormControl>
                                            <RadioGroup
                                                onValueChange={field.onChange}
                                                defaultValue={field.value}
                                                className="flex space-x-4"
                                            >
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="pdf" /></FormControl>
                                                    <FormLabel className="font-normal">PDF</FormLabel>
                                                </FormItem>
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="excel" /></FormControl>
                                                    <FormLabel className="font-normal">Excel (XLSX)</FormLabel>
                                                </FormItem>
                                            </RadioGroup>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <Button type="submit" disabled={isLoading || membersLoading || settingsLoading}>
                                {isLoading ? 'Generating...' : 'Generate Report'}
                            </Button>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}
