
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { format, getYear, startOfMonth, endOfMonth, startOfYear, endOfYear, addMonths } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { DateRange } from 'react-day-picker';

const reportSchema = z.object({
  reportType: z.enum(['monthly', 'yearly', 'custom']),
  year: z.string().optional(),
  month: z.string().optional(),
  dateRange: z.object({
    from: z.date().optional(),
    to: z.date().optional(),
  }).optional(),
  transactionType: z.enum(['all', 'deposit', 'withdrawal']),
  format: z.enum(['pdf', 'excel']),
}).refine(data => {
    if (data.reportType === 'monthly') return !!data.year && !!data.month;
    if (data.reportType === 'yearly') return !!data.year;
    if (data.reportType === 'custom') return !!data.dateRange?.from && !!data.dateRange?.to;
    return false;
}, {
    message: 'Please complete all required fields for the selected report type.',
    path: ['reportType'], // General message at the type level
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
            transactionType: 'all',
            format: 'pdf',
        },
    });

    const reportType = form.watch('reportType');
    
    const getTransactionDate = (tx: Transaction) => {
        if (tx.date instanceof Timestamp) {
            return tx.date.toDate();
        }
        // Fallback for string dates, assuming UTC if no timezone is present
        return new Date(tx.date as string);
    };

    const generateReport = async (values: z.infer<typeof reportSchema>) => {
        if (!user || !firestore || !members || !settings) return;

        setIsLoading(true);

        try {
            const { reportType, year, month, dateRange, transactionType, format: fileFormat } = values;
            let startDate: Date;
            let endDate: Date;
            let reportTitle: string;

            if (reportType === 'monthly' && month && year) {
                const selectedYear = parseInt(year);
                const selectedMonth = parseInt(month);
                startDate = startOfMonth(new Date(selectedYear, selectedMonth));
                endDate = endOfMonth(new Date(selectedYear, selectedMonth));
                reportTitle = `Monthly Report: ${format(startDate, 'MMMM yyyy')}`;
            } else if (reportType === 'yearly' && year) {
                const selectedYear = parseInt(year);
                startDate = startOfYear(new Date(selectedYear, 0));
                endDate = endOfYear(new Date(selectedYear, 0));
                reportTitle = `Yearly Report: ${year}`;
            } else if (reportType === 'custom' && dateRange?.from && dateRange?.to) {
                startDate = dateRange.from;
                endDate = dateRange.to;
                reportTitle = `Custom Report: ${format(startDate, 'dd MMM yyyy')} - ${format(endDate, 'dd MMM yyyy')}`;
            } else {
                 toast({
                    variant: 'destructive',
                    title: 'Invalid Selection',
                    description: 'Please provide all necessary date information.',
                });
                setIsLoading(false);
                return;
            }

            const transactionsQuery = query(
                collection(firestore, `users/${user.uid}/transactions`),
                where('date', '>=', Timestamp.fromDate(startDate)),
                where('date', '<=', Timestamp.fromDate(endDate))
            );

            const querySnapshot = await getDocs(transactionsQuery);
            let transactions = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Transaction));
            
            // Filter by transaction type if not 'all'
            if (transactionType !== 'all') {
                transactions = transactions.filter(tx => tx.type === transactionType);
            }
            
            if (transactions.length === 0) {
                toast({
                    title: 'No Data',
                    description: `No ${transactionType !== 'all' ? transactionType + ' ' : ''}transactions found for the selected period.`,
                });
                setIsLoading(false);
                return;
            }

            // Calculate summary based on the filtered transactions for the period
            const totalDepositsForPeriod = transactions.filter(tx => tx.type === 'deposit').reduce((sum, tx) => sum + tx.amount, 0);
            const totalWithdrawalsForPeriod = transactions.filter(tx => tx.type === 'withdrawal').reduce((sum, tx) => sum + tx.amount, 0);
            const netChange = totalDepositsForPeriod - totalWithdrawalsForPeriod;
            
            const totalDepositedAllTime = members.reduce((sum, member) => sum + member.totalDeposited, 0);
            const totalRemainingFund = settings.totalFund;
            
             const summary = {
                'Total Deposited (All Time)': `Rs. ${totalDepositedAllTime.toLocaleString('en-IN')}`,
                'Total Remaining Fund (Current Balance)': `Rs. ${totalRemainingFund.toLocaleString('en-IN')}`,
                'Deposits in this Period': `Rs. ${totalDepositsForPeriod.toLocaleString('en-IN')}`,
                'Withdrawals in this Period': `Rs. ${totalWithdrawalsForPeriod.toLocaleString('en-IN')}`,
                'Net Change in this Period': `Rs. ${netChange.toLocaleString('en-IN')}`,
            };

            const dataForExport = transactions.map(tx => ({
                'Member Name': members.find(m => m.id === tx.memberId)?.name || 'Unknown',
                'Date': format(getTransactionDate(tx), 'yyyy-MM-dd'),
                'Type': tx.type,
                'Description': tx.description,
                'Amount': tx.amount.toFixed(2),
            }));


            if (fileFormat === 'pdf') {
                const doc = new jsPDF();
                doc.text(reportTitle, 14, 16);
                doc.setFontSize(10);
                doc.text(`Transaction Type: ${transactionType.charAt(0).toUpperCase() + transactionType.slice(1)}`, 14, 22);

                // Add summary table
                autoTable(doc, {
                    body: Object.entries(summary),
                    startY: 28,
                    theme: 'striped',
                    styles: { fontSize: 10 },
                    head: [['Metric', 'Amount (INR)']],
                    headStyles: { fillColor: [34, 139, 34] },
                });
                
                // Add main data table
                autoTable(doc, {
                    head: [['Member Name', 'Date', 'Type', 'Description', 'Amount']],
                    body: dataForExport.map(Object.values),
                    startY: (doc as any).lastAutoTable.finalY + 10,
                });

                doc.save(`report-${reportType}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
            } else if (fileFormat === 'excel') {
                const summarySheetData = Object.entries(summary).map(([key, value]) => ({ 'Metric': key, 'Amount (INR)': value }));
                const summaryWorksheet = XLSX.utils.json_to_sheet(summarySheetData);
                const dataWorksheet = XLSX.utils.json_to_sheet(dataForExport);
                
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
                XLSX.utils.book_append_sheet(workbook, dataWorksheet, 'Transactions');
                
                XLSX.writeFile(workbook, `report-${reportType}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
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
                                        <FormLabel>Report Period</FormLabel>
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
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="custom" /></FormControl>
                                                    <FormLabel className="font-normal">Custom Range</FormLabel>
                                                </FormItem>
                                            </RadioGroup>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                             { (reportType === 'monthly' || reportType === 'yearly') && (
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
                            )}

                            {reportType === 'custom' && (
                                <FormField
                                    control={form.control}
                                    name="dateRange"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col">
                                            <FormLabel>Date range</FormLabel>
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <Button
                                                        id="date"
                                                        variant={"outline"}
                                                        className={cn(
                                                            "w-[300px] justify-start text-left font-normal",
                                                            !field.value?.from && "text-muted-foreground"
                                                        )}
                                                    >
                                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                                        {field.value?.from ? (
                                                            field.value.to ? (
                                                                <>
                                                                    {format(field.value.from, "LLL dd, y")} -{" "}
                                                                    {format(field.value.to, "LLL dd, y")}
                                                                </>
                                                            ) : (
                                                                format(field.value.from, "LLL dd, y")
                                                            )
                                                        ) : (
                                                            <span>Pick a date range</span>
                                                        )}
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-auto p-0" align="start">
                                                    <Calendar
                                                        initialFocus
                                                        mode="range"
                                                        captionLayout="dropdown-buttons"
                                                        fromYear={getYear(new Date()) - 10}
                                                        toYear={getYear(new Date())}
                                                        selected={field.value}
                                                        onSelect={field.onChange}
                                                        numberOfMonths={2}
                                                    />
                                                </PopoverContent>
                                            </Popover>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}

                             <FormField
                                control={form.control}
                                name="transactionType"
                                render={({ field }) => (
                                    <FormItem className="space-y-3">
                                        <FormLabel>Transaction Type</FormLabel>
                                        <FormControl>
                                            <RadioGroup
                                                onValueChange={field.onChange}
                                                defaultValue={field.value}
                                                className="flex flex-col space-y-1"
                                            >
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="all" /></FormControl>
                                                    <FormLabel className="font-normal">All Transactions</FormLabel>
                                                </FormItem>
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="deposit" /></FormControl>
                                                    <FormLabel className="font-normal">Deposits Only</FormLabel>
                                                </FormItem>
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="withdrawal" /></FormControl>
                                                    <FormLabel className="font-normal">Withdrawals Only</FormLabel>
                                                </FormItem>
                                            </RadioGroup>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

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

    
