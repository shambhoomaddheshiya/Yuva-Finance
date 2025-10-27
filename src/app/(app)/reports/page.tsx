
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { Member, Transaction } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format, getYear, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';


const reportSchema = z.object({
  reportType: z.enum(['monthly', 'yearly', 'all', 'custom']),
  year: z.string().optional(),
  month: z.string().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  transactionType: z.enum(['all', 'deposit', 'loan', 'repayment', 'deposits-repayments']),
  format: z.enum(['pdf', 'excel']),
  exportScope: z.enum(['all', 'member']),
  memberId: z.string().optional(),
}).superRefine((data, ctx) => {
    if (data.reportType === 'monthly' && (!data.year || !data.month)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Year and month are required for monthly reports.", path: ['reportType']});
    }
    if (data.reportType === 'yearly' && !data.year) {
         ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Year is required for yearly reports.", path: ['reportType']});
    }
    if (data.reportType === 'custom' && !data.startDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Start date is required for custom reports.", path: ['startDate']});
    }
    if (data.reportType === 'custom' && !data.endDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End date is required for custom reports.", path: ['endDate']});
    }
    if (data.exportScope === 'member' && !data.memberId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please select a member.", path: ['memberId']});
    }
});


export default function ReportsPage() {
    const { toast } = useToast();
    const { user } = useUser();
    const firestore = useFirestore();
    const [isLoading, setIsLoading] = useState(false);
    
    const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);
    const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);
    
    const form = useForm<z.infer<typeof reportSchema>>({
        resolver: zodResolver(reportSchema),
        defaultValues: {
            reportType: 'all',
            transactionType: 'all',
            format: 'pdf',
            exportScope: 'all',
        },
    });
    
    const reportType = form.watch('reportType');
    const exportScope = form.watch('exportScope');
    
    const getTransactionDate = (tx: Transaction) => {
        if (tx.date instanceof Timestamp) {
            return tx.date.toDate();
        }
        return new Date(tx.date as string);
    };

    const generateReport = async (values: z.infer<typeof reportSchema>) => {
        if (!user || !firestore || !members ) return;

        setIsLoading(true);

        try {
            const { reportType, year, month, startDate: customStartDate, endDate: customEndDate, transactionType, format: fileFormat, exportScope, memberId } = values;
            
            let startDate: Date | null = null;
            let endDate: Date | null = null;
            let reportTitle: string = 'Group Transactions Report';
            let memberName: string | undefined;

            const allTransactionsQuery = query(collection(firestore, `users/${user.uid}/transactions`));
            const allTransactionsSnapshot = await getDocs(allTransactionsQuery);
            let allTransactions = allTransactionsSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Transaction));
            
            if (exportScope === 'member' && memberId) {
                memberName = members.find(m => m.id === memberId)?.name;
                reportTitle = `${memberName}'s Transaction Report`;
            }

            if (reportType === 'monthly' && month && year) {
                const selectedYear = parseInt(year);
                const selectedMonth = parseInt(month);
                startDate = startOfMonth(new Date(selectedYear, selectedMonth));
                endDate = endOfMonth(new Date(selectedYear, selectedMonth));
                reportTitle = `${reportTitle}: ${format(startDate, 'MMMM yyyy')}`;
            } else if (reportType === 'yearly' && year) {
                const selectedYear = parseInt(year);
                startDate = startOfYear(new Date(selectedYear, 0));
                endDate = endOfYear(new Date(selectedYear, 0));
                reportTitle = `${reportTitle}: ${year}`;
            } else if (reportType === 'custom' && customStartDate) {
                startDate = customStartDate;
                endDate = customEndDate || customStartDate;
                reportTitle = `${reportTitle}: ${format(startDate, 'dd/MM/yy')} - ${format(endDate, 'dd/MM/yy')}`;
            }

            let transactionsForReport = allTransactions;
            
            // Filter by scope (all active or specific member)
            if (exportScope === 'member' && memberId) {
                transactionsForReport = transactionsForReport.filter(tx => tx.memberId === memberId);
            }


            // Filter by date range
            if (startDate && endDate) {
                 transactionsForReport = transactionsForReport.filter(tx => {
                    const txDate = getTransactionDate(tx);
                    return txDate >= startDate! && txDate <= endDate!;
                });
            }
            
            // Filter by transaction type
            if (transactionType !== 'all') {
                if (transactionType === 'deposits-repayments') {
                    transactionsForReport = transactionsForReport.filter(tx => tx.type === 'deposit' || tx.type === 'repayment');
                } else {
                    transactionsForReport = transactionsForReport.filter(tx => tx.type === transactionType);
                }
            }
            
            if (transactionsForReport.length === 0) {
                toast({
                    title: 'No Data',
                    description: `No ${transactionType !== 'all' ? transactionType.replace('-', ' & ') + ' ' : ''}transactions found for the selected criteria.`,
                });
                setIsLoading(false);
                return;
            }
            
            // Calculate totals based on the filtered transactions for the report
            const memberDeposits = transactionsForReport
                .filter(t => t.type === 'deposit')
                .reduce((sum, t) => sum + t.amount, 0);
            
            const totalLoan = transactionsForReport
                .filter(t => t.type === 'loan')
                .reduce((sum, t) => sum + t.amount, 0);

            const totalRepayment = transactionsForReport
                .filter(t => t.type === 'repayment')
                .reduce((sum, t) => sum + (t.principal || 0), 0);
            
            const totalInterest = transactionsForReport
                .filter(t => t.type === 'repayment')
                .reduce((sum, t) => sum + (t.interest || 0), 0);
            
            const totalDeposits = memberDeposits + totalInterest;

             const summary = {
                'Total Deposits (Members + Interest)': `Rs. ${totalDeposits.toLocaleString('en-IN')}`,
                'Total Loans': `Rs. ${totalLoan.toLocaleString('en-IN')}`,
                'Total Principal Repaid': `Rs. ${totalRepayment.toLocaleString('en-IN')}`,
                'Total Interest Earned': `Rs. ${totalInterest.toLocaleString('en-IN')}`,
            };

            const dataForExport = transactionsForReport.map(tx => ({
                'Member Name': members.find(m => m.id === tx.memberId)?.name || 'Unknown',
                'Date': format(getTransactionDate(tx), 'yyyy-MM-dd'),
                'Type': tx.type,
                'Description': tx.description || '-',
                'Total Amount': tx.amount.toFixed(2),
                'Principal': tx.type === 'repayment' ? (tx.principal || 0).toFixed(2) : '-',
                'Interest': tx.type === 'repayment' ? (tx.interest || 0).toFixed(2) : '-',
            }));


            if (fileFormat === 'pdf') {
                const doc = new jsPDF();
                doc.text(reportTitle, 14, 16);
                doc.setFontSize(10);
                doc.text(`Transaction Type: ${transactionType.charAt(0).toUpperCase() + transactionType.slice(1).replace('-', ' & ')}`, 14, 22);

                autoTable(doc, {
                    body: Object.entries(summary),
                    startY: 28,
                    theme: 'striped',
                    styles: { fontSize: 10 },
                    head: [['Summary Metric', 'Amount (INR)']],
                    headStyles: { fillColor: [34, 139, 34] },
                });
                
                autoTable(doc, {
                    head: [['Member Name', 'Date', 'Type', 'Description', 'Total Amount', 'Principal', 'Interest']],
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
                                name="exportScope"
                                render={({ field }) => (
                                    <FormItem className="space-y-3">
                                        <FormLabel>Export Scope</FormLabel>
                                        <FormControl>
                                            <RadioGroup
                                                onValueChange={field.onChange}
                                                defaultValue={field.value}
                                                className="flex flex-col space-y-1"
                                            >
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="all" /></FormControl>
                                                    <FormLabel className="font-normal">All Members</FormLabel>
                                                </FormItem>
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="member" /></FormControl>
                                                    <FormLabel className="font-normal">Specific Member</FormLabel>
                                                </FormItem>
                                            </RadioGroup>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {exportScope === 'member' && (
                                 <FormField
                                    control={form.control}
                                    name="memberId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Member</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value} disabled={membersLoading}>
                                                <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select a member to export" />
                                                </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                {members?.map((m) => (
                                                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                                ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}

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
                                                    <FormControl><RadioGroupItem value="all" /></FormControl>
                                                    <FormLabel className="font-normal">All Time</FormLabel>
                                                </FormItem>
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
                                <div className="flex flex-col sm:flex-row gap-4">
                                    <FormField
                                        control={form.control}
                                        name="startDate"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-col flex-1">
                                                <FormLabel>Start Date</FormLabel>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <FormControl>
                                                            <Button
                                                                variant="outline"
                                                                className={cn(
                                                                    "w-full justify-start text-left font-normal",
                                                                    !field.value && "text-muted-foreground"
                                                                )}
                                                            >
                                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                                {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0" align="start">
                                                        <Calendar
                                                            mode="single"
                                                            selected={field.value}
                                                            onSelect={field.onChange}
                                                            captionLayout="dropdown-buttons"
                                                            fromYear={getYear(new Date()) - 10}
                                                            toYear={getYear(new Date())}
                                                            initialFocus
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                     <FormField
                                        control={form.control}
                                        name="endDate"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-col flex-1">
                                                <FormLabel>End Date</FormLabel>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <FormControl>
                                                            <Button
                                                                variant="outline"
                                                                className={cn(
                                                                    "w-full justify-start text-left font-normal",
                                                                    !field.value && "text-muted-foreground"
                                                                )}
                                                            >
                                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                                {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0" align="start">
                                                        <Calendar
                                                            mode="single"
                                                            selected={field.value}
                                                            onSelect={field.onChange}
                                                            captionLayout="dropdown-buttons"
                                                            fromYear={getYear(new Date()) - 10}
                                                            toYear={getYear(new Date())}
                                                            initialFocus
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
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
                                                className="flex flex-wrap gap-x-4 gap-y-1"
                                            >
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="all" /></FormControl>
                                                    <FormLabel className="font-normal">All</FormLabel>
                                                </FormItem>
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="deposit" /></FormControl>
                                                    <FormLabel className="font-normal">Deposits</FormLabel>
                                                </FormItem>
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="loan" /></FormControl>
                                                    <FormLabel className="font-normal">Loans</FormLabel>
                                                </FormItem>
                                                 <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="repayment" /></FormControl>
                                                    <FormLabel className="font-normal">Repayments</FormLabel>
                                                </FormItem>
                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                    <FormControl><RadioGroupItem value="deposits-repayments" /></FormControl>
                                                    <FormLabel className="font-normal">Deposits & Repayments</FormLabel>
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

                            <Button type="submit" disabled={isLoading || membersLoading}>
                                {isLoading ? 'Generating...' : 'Generate Report'}
                            </Button>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}
