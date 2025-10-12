
'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, Loader2, Calendar as CalendarIcon, ArrowDown, ArrowUp, Search, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { collection, doc, getDoc, query, writeBatch, where, getDocs, deleteDoc, Timestamp } from 'firebase/firestore';
import { format, getYear } from 'date-fns';

import { useCollection } from '@/firebase/firestore/use-collection';
import { useToast } from '@/hooks/use-toast';
import type { Member, Transaction, GroupSettings } from '@/types';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';


import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { DateRange } from 'react-day-picker';

const transactionSchema = z.object({
  memberId: z.string().nonempty('Please select a member.'),
  type: z.enum(['deposit', 'withdrawal'], {
    required_error: 'You need to select a transaction type.',
  }),
  amount: z.coerce.number().positive('Amount must be a positive number.'),
  date: z.date({ required_error: 'A date is required.' }),
  description: z.string().optional(),
});

// For the edit form
const editTransactionSchema = transactionSchema.omit({ memberId: true, type: true });


function AddTransactionForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const { user } = useUser();
  const firestore = useFirestore();
  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);
  const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);

  const form = useForm<z.infer<typeof transactionSchema>>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      memberId: '',
      amount: 0,
      description: '',
      date: new Date(),
      type: 'deposit'
    },
  });

  const handleMemberChange = (memberId: string) => {
    const member = members?.find(m => m.id === memberId) || null;
    setSelectedMember(member);
    form.setValue('memberId', memberId);
  }

  async function onSubmit(values: z.infer<typeof transactionSchema>) {
    if (!user || !firestore) return;

    setIsLoading(true);
    try {
        const batch = writeBatch(firestore);
        const memberDocRef = doc(firestore, `users/${user.uid}/members`, values.memberId);
        const settingsDocRef = doc(firestore, `users/${user.uid}/groupSettings`, 'settings');

        const memberSnapshot = await getDoc(memberDocRef);
        if (!memberSnapshot.exists()) throw new Error('Selected member not found.');
        const memberData = memberSnapshot.data() as Member;
        
        const settingsSnapshot = await getDoc(settingsDocRef);
        if (!settingsSnapshot.exists()) throw new Error("Group settings not found.");
        const settingsData = settingsSnapshot.data() as GroupSettings;
        
        const amountChange = values.type === 'deposit' ? values.amount : -values.amount;

        if (values.type === 'withdrawal' && memberData.currentBalance < values.amount) {
            throw new Error('Withdrawal amount exceeds member balance.');
        }

        const newMemberBalance = memberData.currentBalance + amountChange;

        // 1. Create the new transaction
        const newTxRef = doc(collection(firestore, `users/${user.uid}/transactions`));
        const newTransaction: Omit<Transaction, 'id'> = {
            memberId: values.memberId,
            type: values.type,
            amount: values.amount,
            date: Timestamp.fromDate(values.date),
            description: values.description,
            balance: newMemberBalance, // The new balance after this transaction
        };
        batch.set(newTxRef, newTransaction);
        
        // 2. Update member's balance and totals
        const newTotalDeposited = memberData.totalDeposited + (values.type === 'deposit' ? values.amount : 0);
        const newTotalWithdrawn = memberData.totalWithdrawn + (values.type === 'withdrawal' ? values.amount : 0);
        const memberUpdateData: Partial<Member> = {
            currentBalance: newMemberBalance,
            totalDeposited: newTotalDeposited,
            totalWithdrawn: newTotalWithdrawn,
        };
        batch.update(memberDocRef, memberUpdateData);
        
        // 3. Update group's total fund
        const newTotalFund = settingsData.totalFund + amountChange;
        batch.update(settingsDocRef, { totalFund: newTotalFund });
        
        await batch.commit();

        toast({
            title: 'Success!',
            description: 'New transaction has been recorded.',
        });
        form.reset();
        onOpenChange(false);
    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Uh oh! Something went wrong.',
            description: error.message || 'There was a problem with your request.',
        });
    } finally {
        setIsLoading(false);
    }
}


  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="memberId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Member</FormLabel>
              <Select onValueChange={handleMemberChange} defaultValue={field.value} disabled={membersLoading}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a member" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {members && members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
               {selectedMember && (
                <p className="text-sm text-muted-foreground mt-2">
                  Current Balance: <span className="font-medium">₹{selectedMember.currentBalance.toLocaleString('en-IN')}</span>
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>Transaction Type</FormLabel>
              <FormControl>
                <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4">
                  <FormItem className="flex items-center space-x-3 space-y-0">
                    <FormControl><RadioGroupItem value="deposit" /></FormControl>
                    <FormLabel className="font-normal">Deposit</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center space-x-3 space-y-0">
                    <FormControl><RadioGroupItem value="withdrawal" /></FormControl>
                    <FormLabel className="font-normal">Withdrawal</FormLabel>
                  </FormItem>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Amount</FormLabel>
              <FormControl><Input type="number" placeholder="2000" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={'outline'}
                      className={cn(
                        'w-[240px] pl-3 text-left font-normal',
                        !field.value && 'text-muted-foreground'
                      )}
                    >
                      {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    captionLayout="dropdown-buttons"
                    fromYear={getYear(new Date()) - 10}
                    toYear={getYear(new Date())}
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
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
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl><Textarea placeholder="मासिक जमा - ..." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record Transaction
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function EditTransactionForm({ onOpenChange, transaction }: { onOpenChange: (open: boolean) => void, transaction: Transaction }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useUser();
  const firestore = useFirestore();

  const getDateFromTransaction = (tx: Transaction) => {
    if (tx.date instanceof Timestamp) {
      return tx.date.toDate();
    }
    // Fallback for string dates, assuming UTC to avoid timezone shifts on conversion
    return new Date(tx.date as string);
  }


  const form = useForm<z.infer<typeof editTransactionSchema>>({
    resolver: zodResolver(editTransactionSchema),
    defaultValues: {
      amount: transaction.amount,
      date: getDateFromTransaction(transaction),
      description: transaction.description || '',
    },
  });

  async function onSubmit(values: z.infer<typeof editTransactionSchema>) {
    if (!user || !firestore) return;
    setIsLoading(true);
    
    try {
        const batch = writeBatch(firestore);
        const txRef = doc(firestore, `users/${user.uid}/transactions`, transaction.id);
        const memberRef = doc(firestore, `users/${user.uid}/members`, transaction.memberId);
        const settingsRef = doc(firestore, `users/${user.uid}/groupSettings`, 'settings');

        const memberSnap = await getDoc(memberRef);
        if (!memberSnap.exists()) throw new Error("Member not found.");
        const memberData = memberSnap.data() as Member;

        const settingsSnap = await getDoc(settingsRef);
        if (!settingsSnap.exists()) throw new Error("Settings not found.");
        const settingsData = settingsSnap.data() as GroupSettings;

        const oldAmount = transaction.amount;
        const newAmount = values.amount;
        const amountDifference = newAmount - oldAmount;
        
        // This is the net change for the balance based on transaction type
        const balanceChange = transaction.type === 'deposit' ? amountDifference : -amountDifference;

        if (memberData.currentBalance + balanceChange < 0) {
            throw new Error("Updating this transaction would result in a negative balance for the member.");
        }
        
        // Calculate new totals for member and group
        const newMemberBalance = memberData.currentBalance + balanceChange;
        const newTotalFund = settingsData.totalFund + balanceChange;
        let newTotalDeposited = memberData.totalDeposited;
        let newTotalWithdrawn = memberData.totalWithdrawn;

        if (transaction.type === 'deposit') {
          newTotalDeposited = memberData.totalDeposited - oldAmount + newAmount;
        } else { // withdrawal
          newTotalWithdrawn = memberData.totalWithdrawn - oldAmount + newAmount;
        }


        // 1. Update the transaction itself
        batch.update(txRef, {
            amount: values.amount,
            date: Timestamp.fromDate(values.date),
            description: values.description || '',
        });

        // 2. Update member's totals
        batch.update(memberRef, { 
          currentBalance: newMemberBalance,
          totalDeposited: newTotalDeposited,
          totalWithdrawn: newTotalWithdrawn,
        });
        
        // 3. Update group's total fund
        batch.update(settingsRef, { totalFund: newTotalFund });

        await batch.commit();

        toast({
            title: 'Success!',
            description: 'Transaction has been updated successfully.',
        });
        onOpenChange(false);
    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Update Failed',
            description: error.message || 'There was a problem updating the transaction.',
        });
    } finally {
        setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Amount</FormLabel>
              <FormControl><Input type="number" placeholder="2000" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={'outline'}
                      className={cn(
                        'w-[240px] pl-3 text-left font-normal',
                        !field.value && 'text-muted-foreground'
                      )}
                    >
                      {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    captionLayout="dropdown-buttons"
                    fromYear={getYear(new Date()) - 10}
                    toYear={getYear(new Date())}
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
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
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl><Textarea placeholder="Description..." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

export default function TransactionsPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const firestore = useFirestore();
  const transactionsRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/transactions`)) : null, [user, firestore]);
  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);

  const { data: transactions, isLoading: txLoading } = useCollection<Transaction>(transactionsRef);
  const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedYear, setSelectedYear] = useState<string>(String(getYear(new Date())));
  const [selectedMonth, setSelectedMonth] = useState<string>(String(new Date().getMonth()));
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const loading = txLoading || membersLoading;

  const years = Array.from({ length: 10 }, (_, i) => getYear(new Date()) - i);
  const months = Array.from({ length: 12 }, (_, i) => ({
      value: String(i),
      label: format(new Date(0, i), 'MMMM'),
  }));
  
  const getTransactionDate = (tx: Transaction) => {
    if (tx.date instanceof Timestamp) {
        return tx.date.toDate();
    }
    return new Date(tx.date as string);
  };

  const filteredTransactions = useMemo(() => {
    if (!transactions || !members) return [];
    
    let intermediateList = [...transactions].sort((a, b) => getTransactionDate(b).getTime() - getTransactionDate(a).getTime());

    // Date and Type Filtering
    intermediateList = intermediateList.filter(tx => {
        const txDate = getTransactionDate(tx);
        const txYear = getYear(txDate);
        const txMonth = txDate.getMonth();

        switch (filter) {
            case 'deposit':
            case 'withdrawal':
                return tx.type === filter;
            case 'monthly':
                return txYear === parseInt(selectedYear) && txMonth === parseInt(selectedMonth);
            case 'yearly':
                return txYear === parseInt(selectedYear);
            case 'custom':
                if (dateRange?.from && dateRange?.to) {
                    const fromDate = dateRange.from;
                    const toDate = dateRange.to;
                    return txDate >= fromDate && txDate <= toDate;
                }
                return true;
            case 'all':
            default:
                return true;
        }
    });

    if (!searchQuery) return intermediateList;

    const lowercasedQuery = searchQuery.toLowerCase();
    
    return intermediateList.filter(tx => {
      const member = members.find(m => m.id === tx.memberId);
      const memberName = member ? member.name.toLowerCase() : '';
      
      return (
        memberName.includes(lowercasedQuery) ||
        (tx.description && tx.description.toLowerCase().includes(lowercasedQuery))
      );
    });
  }, [transactions, members, searchQuery, filter, selectedYear, selectedMonth, dateRange]);

  const handleEdit = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsEditDialogOpen(true);
  };

  const handleDelete = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedTransaction || !user || !firestore) return;
    setIsDeleting(true);

    try {
        const batch = writeBatch(firestore);
        const txRef = doc(firestore, `users/${user.uid}/transactions`, selectedTransaction.id);
        const memberRef = doc(firestore, `users/${user.uid}/members`, selectedTransaction.memberId);
        const settingsRef = doc(firestore, `users/${user.uid}/groupSettings`, 'settings');

        const amountChange = selectedTransaction.type === 'deposit' ? -selectedTransaction.amount : selectedTransaction.amount;
        
        // 1. Delete the transaction
        batch.delete(txRef);
        
        // 2. Update member's current balance, and totals
        const memberSnap = await getDoc(memberRef);
        if(memberSnap.exists()){
            const memberData = memberSnap.data() as Member;
            const newTotalDeposited = memberData.totalDeposited - (selectedTransaction.type === 'deposit' ? selectedTransaction.amount : 0);
            const newTotalWithdrawn = memberData.totalWithdrawn - (selectedTransaction.type === 'withdrawal' ? selectedTransaction.amount : 0);

            batch.update(memberRef, { 
                currentBalance: memberData.currentBalance + amountChange,
                totalDeposited: newTotalDeposited,
                totalWithdrawn: newTotalWithdrawn,
            });
        }

        // 3. Update group total fund
        const settingsSnap = await getDoc(settingsRef);
        if(settingsSnap.exists()){
            const settingsData = settingsSnap.data() as GroupSettings;
            batch.update(settingsRef, { totalFund: settingsData.totalFund + amountChange });
        }

        await batch.commit();
        
        toast({
            title: 'Success!',
            description: `Transaction has been deleted.`,
        });

    } catch (error: any) {
         toast({
            variant: 'destructive',
            title: 'Delete Failed',
            description: error.message || 'There was a problem deleting the transaction.',
        });
    } finally {
        setIsDeleting(false);
        setIsDeleteDialogOpen(false);
        setSelectedTransaction(undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold font-headline">Transactions</h1>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Transaction
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="font-headline">Record New Transaction</DialogTitle>
              <DialogDescription>
                Select a member and enter the transaction details.
              </DialogDescription>
            </DialogHeader>
            <AddTransactionForm onOpenChange={setIsAddDialogOpen} />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Transaction History</CardTitle>
           <div className="space-y-4 pt-2">
             <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by member, description..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <RadioGroup
                value={filter}
                onValueChange={setFilter}
                className="flex flex-wrap items-center gap-x-4 gap-y-2"
              >
                <Label className="font-semibold">Show:</Label>
                <div className="flex items-center space-x-2"><RadioGroupItem value="all" id="all" /><Label htmlFor="all">All</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="deposit" id="deposit" /><Label htmlFor="deposit">Deposits</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="withdrawal" id="withdrawal" /><Label htmlFor="withdrawal">Withdrawals</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="monthly" id="monthly" /><Label htmlFor="monthly">Monthly</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="yearly" id="yearly" /><Label htmlFor="yearly">Yearly</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="custom" id="custom" /><Label htmlFor="custom">Custom</Label></div>
              </RadioGroup>
              
              {(filter === 'monthly' || filter === 'yearly') && (
                <div className="flex items-center gap-2">
                    <Select onValueChange={setSelectedYear} value={selectedYear}>
                        <SelectTrigger className="w-[120px]"><SelectValue placeholder="Year" /></SelectTrigger>
                        <SelectContent>
                            {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    {filter === 'monthly' && (
                        <Select onValueChange={setSelectedMonth} value={selectedMonth}>
                           <SelectTrigger className="w-[140px]"><SelectValue placeholder="Month" /></SelectTrigger>
                            <SelectContent>
                                {months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                </div>
              )}
               {filter === 'custom' && (
                 <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            id="date"
                            variant={"outline"}
                            className={cn(
                                "w-[300px] justify-start text-left font-normal",
                                !dateRange && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dateRange?.from ? (
                                dateRange.to ? (
                                    <>
                                        {format(dateRange.from, "LLL dd, y")} -{" "}
                                        {format(dateRange.to, "LLL dd, y")}
                                    </>
                                ) : (
                                    format(dateRange.from, "LLL dd, y")
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
                            defaultMonth={dateRange?.from}
                            selected={dateRange}
                            onSelect={setDateRange}
                            numberOfMonths={2}
                        />
                    </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-6 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredTransactions.length > 0 ? (
                filteredTransactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-medium">{members?.find(m => m.id === tx.memberId)?.name || 'Unknown'}</TableCell>
                    <TableCell>
                      <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${tx.type === 'deposit' ? 'border-transparent bg-green-100 text-green-800' : 'border-transparent bg-red-100 text-red-800'}`}>
                        {tx.type === 'deposit' ? <ArrowUp className="mr-1 h-3 w-3" /> : <ArrowDown className="mr-1 h-3 w-3" />}
                        {tx.type}
                      </div>
                    </TableCell>
                    <TableCell>{getTransactionDate(tx).toLocaleDateString()}</TableCell>
                    <TableCell>{tx.description}</TableCell>
                    <TableCell className={`text-right font-mono font-semibold ${tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.type === 'deposit' ? '+' : '-'}₹{tx.amount.toLocaleString('en-IN')}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(tx)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            <span>Edit</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDelete(tx)} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" />
                            <span>Delete</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                     {searchQuery || filter !== 'all' ? 'No transactions match your filters.' : 'No transactions found.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="font-headline">Edit Transaction</DialogTitle>
            <DialogDescription>
              Update the transaction details below. The member and type cannot be changed.
            </DialogDescription>
          </DialogHeader>
          {selectedTransaction && <EditTransactionForm onOpenChange={setIsEditDialogOpen} transaction={selectedTransaction} />}
        </DialogContent>
      </Dialog>
      
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the transaction.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive hover:bg-destructive/90" disabled={isDeleting}>
                    {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Yes, delete transaction
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

    