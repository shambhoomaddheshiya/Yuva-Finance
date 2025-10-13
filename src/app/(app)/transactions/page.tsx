
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, Loader2, Calendar as CalendarIcon, ArrowDown, ArrowUp, Search, MoreHorizontal, Pencil, Trash2, HandCoins } from 'lucide-react';
import { collection, doc, getDoc, query, writeBatch, where, getDocs, deleteDoc, Timestamp, updateDoc } from 'firebase/firestore';
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
  type: z.enum(['deposit', 'loan', 'repayment'], {
    required_error: 'You need to select a transaction type.',
  }),
  amount: z.coerce.number().positive('Amount must be a positive number.'),
  date: z.date({ required_error: 'A date is required.' }),
  description: z.string().optional(),
  principal: z.coerce.number().optional(),
  interest: z.coerce.number().optional(),
}).refine(data => {
    if (data.type === 'repayment') {
        const principal = data.principal || 0;
        const interest = data.interest || 0;
        return principal + interest === data.amount;
    }
    return true;
}, {
    message: "For repayments, Principal + Interest must equal the Total Amount.",
    path: ["amount"],
});


// For the edit form - editing is complex so we'll simplify it
const editTransactionSchema = transactionSchema.omit({ memberId: true, type: true });


function AddTransactionForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const { user } = useUser();
  const firestore = useFirestore();
  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`), where('status', '==', 'active')) : null, [user, firestore]);
  const { data: members, isLoading: membersLoading } = useCollection<Member>(membersRef);

  const form = useForm<z.infer<typeof transactionSchema>>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      memberId: '',
      amount: 0,
      principal: 0,
      interest: 0,
      description: '',
      date: new Date(),
      type: 'deposit'
    },
  });

  const transactionType = useWatch({ control: form.control, name: 'type' });
  const principal = useWatch({ control: form.control, name: 'principal' });
  const interest = useWatch({ control: form.control, name: 'interest' });

  useEffect(() => {
    if (transactionType === 'repayment') {
        const totalAmount = Number(principal || 0) + Number(interest || 0);
        form.setValue('amount', totalAmount, { shouldValidate: true });
    }
  }, [principal, interest, transactionType, form]);


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
        
        let newMemberBalance = memberData.currentBalance;
        let newMemberLoanBalance = memberData.loanBalance || 0;
        let newTotalDeposit = settingsData.totalDeposit || 0;
        let newTotalLoan = settingsData.totalLoan || 0;
        let newTotalRepayment = settingsData.totalRepayment || 0;
        let newTotalInterest = settingsData.totalInterest || 0;
        let finalBalanceForTx = 0;
        
        const newTxData: Omit<Transaction, 'id'> = {
            memberId: values.memberId,
            type: values.type,
            amount: values.amount,
            date: Timestamp.fromDate(values.date),
            description: values.description,
            balance: 0 // Will be set below
        };

        // 2. Update member and group totals based on transaction type
        switch (values.type) {
            case 'deposit':
                newMemberBalance += values.amount;
                newTotalDeposit += values.amount;
                finalBalanceForTx = newMemberBalance;
                batch.update(memberDocRef, { currentBalance: newMemberBalance, totalDeposited: (memberData.totalDeposited || 0) + values.amount });
                break;
            case 'loan':
                newMemberLoanBalance += values.amount;
                newTotalLoan += values.amount;
                finalBalanceForTx = newMemberLoanBalance;
                batch.update(memberDocRef, { loanBalance: newMemberLoanBalance, totalWithdrawn: (memberData.totalWithdrawn || 0) + values.amount });
                break;
            case 'repayment':
                const principalRepaid = values.principal || 0;
                const interestPaid = values.interest || 0;
                
                newMemberLoanBalance -= principalRepaid;
                newTotalRepayment += principalRepaid;
                newTotalInterest += interestPaid;
                finalBalanceForTx = newMemberLoanBalance;
                
                newTxData.principal = principalRepaid;
                newTxData.interest = interestPaid;
                
                batch.update(memberDocRef, { loanBalance: newMemberLoanBalance });
                break;
        }

        newTxData.balance = finalBalanceForTx;
        const newTxRef = doc(collection(firestore, `users/${user.uid}/transactions`));
        batch.set(newTxRef, newTxData);
        
        // 3. Update group's total fund
        const newRemainingFund = newTotalDeposit - (newTotalLoan - newTotalRepayment) + newTotalInterest;
        batch.update(settingsDocRef, { 
            totalDeposit: newTotalDeposit,
            totalLoan: newTotalLoan,
            totalRepayment: newTotalRepayment,
            totalInterest: newTotalInterest,
            totalFund: newRemainingFund // totalFund is used as remainingFund
        });
        
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
                  {members?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
               {selectedMember && (
                <div className="text-sm text-muted-foreground mt-2 grid grid-cols-2">
                    <p>Deposit Balance: <span className="font-medium">₹{selectedMember.currentBalance.toLocaleString('en-IN')}</span></p>
                    <p>Loan Balance: <span className="font-medium">₹{(selectedMember.loanBalance || 0).toLocaleString('en-IN')}</span></p>
                </div>
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
                    <FormControl><RadioGroupItem value="loan" /></FormControl>
                    <FormLabel className="font-normal">Loan</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center space-x-3 space-y-0">
                    <FormControl><RadioGroupItem value="repayment" /></FormControl>
                    <FormLabel className="font-normal">Repayment</FormLabel>
                  </FormItem>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {transactionType === 'repayment' ? (
            <div className="grid grid-cols-2 gap-4">
                <FormField
                    control={form.control}
                    name="principal"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Principal Amount</FormLabel>
                            <FormControl><Input type="number" placeholder="10000" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="interest"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Interest Paid</FormLabel>
                            <FormControl><Input type="number" placeholder="200" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                 <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                        <FormItem className="col-span-2">
                        <FormLabel>Total Amount Repaid</FormLabel>
                        <FormControl><Input type="number" {...field} readOnly className="bg-muted" /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        ) : (
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
        )}
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
    return new Date(tx.date as string);
  }


  const form = useForm<z.infer<typeof editTransactionSchema>>({
    resolver: zodResolver(editTransactionSchema),
    defaultValues: {
      date: getDateFromTransaction(transaction),
      description: transaction.description || '',
      amount: transaction.amount,
      principal: transaction.principal || 0,
      interest: transaction.interest || 0,
    },
  });
  
  const transactionType = transaction.type;
  const principal = useWatch({ control: form.control, name: 'principal' });
  const interest = useWatch({ control: form.control, name: 'interest' });

  useEffect(() => {
    if (transactionType === 'repayment') {
        const totalAmount = Number(principal || 0) + Number(interest || 0);
        form.setValue('amount', totalAmount, { shouldValidate: true });
    }
  }, [principal, interest, transactionType, form]);

  async function onSubmit(values: z.infer<typeof editTransactionSchema>) {
    if (!user || !firestore) return;
    setIsLoading(true);

    try {
        const batch = writeBatch(firestore);
        const txRef = doc(firestore, `users/${user.uid}/transactions`, transaction.id);
        const memberRef = doc(firestore, `users/${user.uid}/members`, transaction.memberId);
        const settingsRef = doc(firestore, `users/${user.uid}/groupSettings`, 'settings');

        const memberSnap = await getDoc(memberRef);
        const settingsSnap = await getDoc(settingsRef);

        if (!memberSnap.exists()) throw new Error("Member not found.");
        if (!settingsSnap.exists()) throw new Error("Settings not found.");
        
        const memberData = memberSnap.data() as Member;
        const settingsData = settingsSnap.data() as GroupSettings;

        // 1. Revert the old transaction
        let newMemberBalance = memberData.currentBalance;
        let newMemberLoanBalance = memberData.loanBalance || 0;
        let newTotalDeposit = settingsData.totalDeposit || 0;
        let newTotalLoan = settingsData.totalLoan || 0;
        let newTotalRepayment = settingsData.totalRepayment || 0;
        let newTotalInterest = settingsData.totalInterest || 0;

        switch (transaction.type) {
            case 'deposit':
                newMemberBalance -= transaction.amount;
                newTotalDeposit -= transaction.amount;
                break;
            case 'loan':
                newMemberLoanBalance -= transaction.amount;
                newTotalLoan -= transaction.amount;
                break;
            case 'repayment':
                newMemberLoanBalance += (transaction.principal || 0);
                newTotalRepayment -= (transaction.principal || 0);
                newTotalInterest -= (transaction.interest || 0);
                break;
        }

        // 2. Apply the new transaction
        const updatedTxData: Partial<Transaction> = {
            date: Timestamp.fromDate(values.date),
            description: values.description,
            amount: values.amount,
        };
        
        switch (transaction.type) {
            case 'deposit':
                newMemberBalance += values.amount;
                newTotalDeposit += values.amount;
                updatedTxData.balance = newMemberBalance;
                break;
            case 'loan':
                newMemberLoanBalance += values.amount;
                newTotalLoan += values.amount;
                updatedTxData.balance = newMemberLoanBalance;
                break;
            case 'repayment':
                const principalRepaid = values.principal || 0;
                const interestPaid = values.interest || 0;
                newMemberLoanBalance -= principalRepaid;
                newTotalRepayment += principalRepaid;
                newTotalInterest += interestPaid;
                
                updatedTxData.principal = principalRepaid;
                updatedTxData.interest = interestPaid;
                updatedTxData.balance = newMemberLoanBalance;
                break;
        }

        // 3. Set updates in batch
        batch.update(memberRef, { currentBalance: newMemberBalance, loanBalance: newMemberLoanBalance });
        
        const newRemainingFund = newTotalDeposit - (newTotalLoan - newTotalRepayment) + newTotalInterest;
        batch.update(settingsRef, { 
            totalDeposit: newTotalDeposit,
            totalLoan: newTotalLoan,
            totalRepayment: newTotalRepayment,
            totalInterest: newTotalInterest,
            totalFund: newRemainingFund,
        });

        batch.update(txRef, updatedTxData);

        await batch.commit();

        toast({
            title: 'Success!',
            description: 'Transaction has been updated.',
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
         {transaction.type === 'repayment' ? (
            <div className="grid grid-cols-2 gap-4">
                <FormField
                    control={form.control}
                    name="principal"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Principal Amount</FormLabel>
                            <FormControl><Input type="number" placeholder="10000" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="interest"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Interest Paid</FormLabel>
                            <FormControl><Input type="number" placeholder="200" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                 <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                        <FormItem className="col-span-2">
                        <FormLabel>Total Amount Repaid</FormLabel>
                        <FormControl><Input type="number" {...field} readOnly className="bg-muted" /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        ) : (
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
        )}
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
  
  const getTxTypeClass = (type: Transaction['type']) => {
    switch (type) {
        case 'deposit': return 'border-transparent bg-green-100 text-green-800';
        case 'loan': return 'border-transparent bg-red-100 text-red-800';
        case 'repayment': return 'border-transparent bg-blue-100 text-blue-800';
        default: return '';
    }
  }

  const getTxAmountClass = (type: Transaction['type']) => {
    switch (type) {
        case 'deposit': return 'text-green-600';
        case 'loan': return 'text-red-600';
        case 'repayment': return 'text-blue-600';
        default: return '';
    }
  }

  const getTxTypeIcon = (type: Transaction['type']) => {
    switch(type) {
      case 'deposit': return <ArrowUp className="mr-1 h-3 w-3" />;
      case 'loan': return <ArrowDown className="mr-1 h-3 w-3" />;
      case 'repayment': return <HandCoins className="mr-1 h-3 w-3" />;
    }
  }
  
  const getTxAmountPrefix = (type: Transaction['type']) => {
    switch (type) {
        case 'deposit': return '+';
        case 'repayment': return '+';
        case 'loan': return '-';
        default: return '';
    }
  }


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
            case 'loan':
            case 'repayment':
                if(filter !== tx.type) return false;
                break;
            case 'monthly':
                if (txYear !== parseInt(selectedYear) || txMonth !== parseInt(selectedMonth)) return false;
                break;
            case 'yearly':
                if(txYear !== parseInt(selectedYear)) return false;
                break;
            case 'custom':
                if (dateRange?.from && dateRange?.to) {
                    const fromDate = dateRange.from;
                    const toDate = dateRange.to;
                    if (txDate < fromDate || txDate > toDate) return false;
                } else {
                    return true;
                }
                break;
            case 'all':
            default:
                break;
        }
        return true;
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

        const memberSnap = await getDoc(memberRef);
        const settingsSnap = await getDoc(settingsRef);

        if (!memberSnap.exists()) throw new Error("Member not found.");
        if (!settingsSnap.exists()) throw new Error("Settings not found.");
        
        const memberData = memberSnap.data() as Member;
        const settingsData = settingsSnap.data() as GroupSettings;

        let { amount, type, principal, interest } = selectedTransaction;

        // Revert member and group totals
        let newMemberBalance = memberData.currentBalance;
        let newMemberLoanBalance = memberData.loanBalance || 0;
        let newTotalDeposit = settingsData.totalDeposit || 0;
        let newTotalLoan = settingsData.totalLoan || 0;
        let newTotalRepayment = settingsData.totalRepayment || 0;
        let newTotalInterest = settingsData.totalInterest || 0;
        
        switch (type) {
            case 'deposit':
                newMemberBalance -= amount;
                newTotalDeposit -= amount;
                batch.update(memberRef, { currentBalance: newMemberBalance, totalDeposited: (memberData.totalDeposited || 0) - amount });
                break;
            case 'loan':
                newMemberLoanBalance -= amount;
                newTotalLoan -= amount;
                batch.update(memberRef, { loanBalance: newMemberLoanBalance, totalWithdrawn: (memberData.totalWithdrawn || 0) - amount });
                break;
            case 'repayment':
                newMemberLoanBalance += (principal || 0);
                newTotalRepayment -= (principal || 0);
                newTotalInterest -= (interest || 0);
                batch.update(memberRef, { loanBalance: newMemberLoanBalance });
                break;
        }

        // Delete the transaction
        batch.delete(txRef);
        
        // Recalculate and update group's remaining fund
        const newRemainingFund = newTotalDeposit - (newTotalLoan - newTotalRepayment) + newTotalInterest;
        batch.update(settingsRef, { 
            totalDeposit: newTotalDeposit,
            totalLoan: newTotalLoan,
            totalRepayment: newTotalRepayment,
            totalInterest: newTotalInterest,
            totalFund: newRemainingFund,
        });

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
          <DialogContent className="sm:max-w-md">
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
                <div className="flex items-center space-x-2"><RadioGroupItem value="loan" id="loan" /><Label htmlFor="loan">Loans</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="repayment" id="repayment" /><Label htmlFor="repayment">Repayments</Label></div>
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
                      <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${getTxTypeClass(tx.type)}`}>
                        {getTxTypeIcon(tx.type)}
                        {tx.type}
                      </div>
                    </TableCell>
                    <TableCell>{getTransactionDate(tx).toLocaleDateString()}</TableCell>
                    <TableCell>{tx.description}</TableCell>
                    <TableCell className={`text-right font-mono font-semibold ${getTxAmountClass(tx.type)}`}>
                      {getTxAmountPrefix(tx.type)}₹{tx.amount.toLocaleString('en-IN')}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Edit Transaction</DialogTitle>
            <DialogDescription>
              Update the transaction details below. Balances will be recalculated automatically.
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
                    This action cannot be undone. This will permanently delete the transaction and adjust member/group balances accordingly.
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
