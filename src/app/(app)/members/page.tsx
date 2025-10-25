
'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, Loader2, MoreHorizontal, Pencil, BookUser, Calendar as CalendarIcon, ArrowDown, ArrowUp, Trash2, Search, UserCheck, UserX, HandCoins, Percent, ShieldX, Archive } from 'lucide-react';
import { format, getYear } from 'date-fns';
import { collection, doc, query, where, writeBatch, getDocs, deleteDoc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';

import { useCollection } from '@/firebase/firestore/use-collection';
import { useToast } from '@/hooks/use-toast';
import type { Member, Transaction, GroupSettings } from '@/types';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
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
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

const memberSchema = z.object({
  id: z.string().min(1, 'Member ID cannot be empty.'),
  name: z.string().min(2, 'Name must be at least 2 characters.'),
  phone: z.string().regex(/^\d{10}$/, 'Phone number must be 10 digits.'),
  aadhaar: z.string().refine(value => /^\d{4}-?\d{4}-?\d{4}$/.test(value) || /^\d{12}$/.test(value), {
    message: 'Aadhaar must be 12 digits.',
  }),
  joinDate: z.date({ required_error: 'A join date is required.' }),
});

function formatAadhaar(value: string) {
    const numericValue = value.replace(/-/g, '');
    let formattedValue = '';
    if (numericValue.length > 0) {
        formattedValue = numericValue.match(/.{1,4}/g)?.join('-') || '';
    }
    return formattedValue.substring(0, 14); // 12 digits + 2 hyphens
}

function MemberForm({ onOpenChange, member, isEdit = false }: { onOpenChange: (open: boolean) => void, member?: Member, isEdit?: boolean }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useUser();
  const firestore = useFirestore();

  const form = useForm<z.infer<typeof memberSchema>>({
    resolver: zodResolver(memberSchema),
    defaultValues: { 
      id: member?.id || '',
      name: member?.name || '', 
      phone: member?.phone || '',
      aadhaar: member ? formatAadhaar(member.aadhaar) : '',
      joinDate: member ? new Date(member.joinDate) : new Date(),
    },
  });

  async function onSubmit(values: z.infer<typeof memberSchema>) {
    if (!user || !firestore) return;
    setIsLoading(true);
    try {
        const aadhaarUnformatted = values.aadhaar.replace(/-/g, '');
        
        if (isEdit && member) {
            // Logic for editing a member
            if (member.id !== values.id) {
                // ID has changed, complex update (migrate data)
                const batch = writeBatch(firestore);
                const newMemberDocRef = doc(firestore, `users/${user.uid}/members`, values.id);
                const newMemberData: Member = {
                    ...member,
                    id: values.id, name: values.name, phone: values.phone, aadhaar: aadhaarUnformatted, joinDate: values.joinDate.toISOString(),
                };
                batch.set(newMemberDocRef, newMemberData);

                const transactionsQuery = query(collection(firestore, `users/${user.uid}/transactions`), where('memberId', '==', member.id));
                const transactionsSnapshot = await getDocs(transactionsQuery);
                transactionsSnapshot.forEach(txDoc => {
                    batch.update(txDoc.ref, { memberId: values.id });
                });

                const oldMemberDocRef = doc(firestore, `users/${user.uid}/members`, member.id);
                batch.delete(oldMemberDocRef);
                
                await batch.commit();
                toast({ title: 'Success!', description: 'Member ID changed and transactions updated.' });

            } else {
                // ID is the same, simple update
                const memberRef = doc(firestore, `users/${user.uid}/members`, member.id);
                const updatePayload: Partial<Member> = {
                    name: values.name, phone: values.phone, aadhaar: aadhaarUnformatted, joinDate: values.joinDate.toISOString()
                };
                await updateDoc(memberRef, updatePayload);
                toast({ title: 'Success!', description: 'Member has been updated.' });
            }
        } else {
            // Logic for adding a new member
            const newMember: Member = {
                id: values.id, name: values.name, phone: values.phone, aadhaar: aadhaarUnformatted,
                joinDate: values.joinDate.toISOString(),
                status: 'active', // New members are active by default
            };
            const newMemberRef = doc(firestore, `users/${user.uid}/members`, values.id);
            await setDoc(newMemberRef, newMember);
            toast({ title: 'Success!', description: 'New member has been added.' });
        }
      
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
            name="id"
            render={({ field }) => (
                <FormItem>
                <FormLabel>Member ID</FormLabel>
                <FormControl>
                    <Input placeholder="MEMBER-001" {...field} />
                </FormControl>
                <FormMessage />
                </FormItem>
            )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input placeholder="Rahul Sharma" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone Number</FormLabel>
              <FormControl>
                <Input placeholder="9876543210" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
         <FormField
          control={form.control}
          name="aadhaar"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Aadhaar Number</FormLabel>
              <FormControl>
                <Input 
                    placeholder="1234-5678-9012" 
                    {...field}
                    onChange={(e) => {
                        const formatted = formatAadhaar(e.target.value);
                        field.onChange(formatted);
                    }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
         <FormField
          control={form.control}
          name="joinDate"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Join Date</FormLabel>
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
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Add Member'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}


function PassbookView({ member, allMembers, transactions }: { member: Member, allMembers: Member[], transactions: Transaction[] | null }) {
    const isLoading = !transactions;

    const getTransactionDate = (tx: Transaction): Date => {
        if (!tx?.date) return new Date();
        if (tx.date instanceof Timestamp) {
            return tx.date.toDate();
        }
        if (tx.date instanceof Date) {
            return tx.date;
        }
        return new Date(tx.date as string);
    };
  
    const { sortedTransactions, depositBalance, loanBalance, interestShare, grandTotal } = useMemo(() => {
        if (!transactions || !allMembers) {
            return { sortedTransactions: [], depositBalance: 0, loanBalance: 0, interestShare: 0, grandTotal: 0 };
        }
        
        // Active members for interest calculation now includes 'closed' members who were previously active
        const membersForInterestCalc = allMembers.filter(m => m.status === 'active' || m.status === 'closed');
        const contributingMembersCount = membersForInterestCalc.length;

        const allContributingMemberIds = new Set(membersForInterestCalc.map(m => m.id));

        const totalInterest = transactions
            .filter(t => t.type === 'repayment' && allContributingMemberIds.has(t.memberId))
            .reduce((sum, t) => sum + (t.interest || 0), 0);

        const memberTransactions = transactions.filter(t => t.memberId === member.id);
        const sorted = [...memberTransactions].sort((a, b) => getTransactionDate(b).getTime() - getTransactionDate(a).getTime());
        
        const depositTotal = sorted
            .filter(t => t.type === 'deposit')
            .reduce((sum, t) => sum + t.amount, 0);

        const loanTotal = sorted
            .filter(t => t.type === 'loan')
            .reduce((sum, t) => sum + t.amount, 0);
        
        const repaymentTotal = sorted
            .filter(t => t.type === 'repayment')
            .reduce((sum, t) => sum + (t.principal || 0), 0);

        const loanWaivedTotal = sorted
            .filter(t => t.type === 'loan-waived')
            .reduce((sum, t) => sum + t.amount, 0);

        const calculatedLoanBalance = loanTotal - repaymentTotal - loanWaivedTotal;
        
        // Only give interest share if the member is 'active' or 'closed'. 'inactive' members don't get a share.
        const calculatedInterestShare = member.status !== 'inactive' && contributingMembersCount > 0 ? totalInterest / contributingMembersCount : 0;
        const calculatedGrandTotal = depositTotal + calculatedInterestShare;

        return { 
            sortedTransactions: sorted, 
            depositBalance: depositTotal, 
            loanBalance: calculatedLoanBalance,
            interestShare: calculatedInterestShare,
            grandTotal: calculatedGrandTotal
        };
    }, [transactions, member, allMembers]);
    
    const getTxTypeClass = (type: Transaction['type']) => {
        switch (type) {
            case 'deposit': return 'border-transparent bg-green-100 text-green-800';
            case 'loan': return 'border-transparent bg-red-100 text-red-800';
            case 'repayment': return 'border-transparent bg-blue-100 text-blue-800';
            case 'loan-waived': return 'border-transparent bg-yellow-100 text-yellow-800';
            default: return '';
        }
    }
    const getTxAmountClass = (type: Transaction['type']) => {
        switch (type) {
            case 'deposit': return 'text-green-600';
            case 'loan': return 'text-red-600';
            case 'repayment': return 'text-blue-600';
            case 'loan-waived': return 'text-yellow-600';
            default: return '';
        }
    }
     const getTxTypeIcon = (type: Transaction['type']) => {
        switch(type) {
          case 'deposit': return <ArrowUp className="mr-1 h-3 w-3" />;
          case 'loan': return <ArrowDown className="mr-1 h-3 w-3" />;
          case 'repayment': return <HandCoins className="mr-1 h-3 w-3" />;
          case 'loan-waived': return <ShieldX className="mr-1 h-3 w-3" />;
        }
      }
      const getTxAmountPrefix = (type: Transaction['type']) => {
        switch (type) {
            case 'deposit': return '+';
            case 'repayment': return '+';
            case 'loan': return '-';
            case 'loan-waived': return '-';
            default: return '';
        }
      }

    return (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b shrink-0">
                 <DialogHeader className="p-0 text-left">
                    <DialogTitle className='font-headline'>Member Passbook: {member.name}</DialogTitle>
                    <DialogDescription>
                        Transaction history and financial summary.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-4">
                    <p><span className="font-semibold">ID:</span> {member.id}</p>
                    <p><span className="font-semibold">Mob No:</span> {member.phone}</p>
                    <p><span className="font-semibold">Aadhaar:</span> {formatAadhaar(member.aadhaar)}</p>
                    <p><span className="font-semibold">Joined:</span> {new Date(member.joinDate).toLocaleDateString()}</p>
                    <p className="font-medium"><span className="font-semibold">Loan Balance:</span> Rs. {loanBalance.toLocaleString('en-IN')}</p>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                     <div className="p-6 space-y-2">
                        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                     </div>
                ) : sortedTransactions.length > 0 ? (
                    <Table>
                        <TableHeader className="sticky top-0 bg-card z-10">
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedTransactions.map(tx => (
                                <TableRow key={tx.id}>
                                    <TableCell>{getTransactionDate(tx).toLocaleDateString()}</TableCell>
                                    <TableCell className='capitalize'>
                                        <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${getTxTypeClass(tx.type)}`}>
                                            {getTxTypeIcon(tx.type)}
                                            {tx.type.replace('-', ' ')}
                                        </div>
                                    </TableCell>
                                    <TableCell className={`text-right font-medium ${getTxAmountClass(tx.type)}`}>
                                        {getTxAmountPrefix(tx.type)}Rs. {tx.amount.toLocaleString('en-IN')}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : (
                    <div className="flex h-full items-center justify-center">
                        <p className="p-6 text-center text-muted-foreground">No transactions found for this member.</p>
                    </div>
                )}
            </div>
             <div className="p-4 mt-auto border-t bg-slate-50 shrink-0">
                 <div className="w-full space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Deposits</span>
                        <span className="font-medium">Rs. {depositBalance.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Interest Earned</span>
                        <span className="font-medium">Rs. {interestShare.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between font-bold text-base">
                        <span>Grand Total (Deposits + Interest)</span>
                        <span>Rs. {grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                 </div>
            </div>
        </div>
    )
}


export default function MembersPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const firestore = useFirestore();
  
  const membersRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/members`)) : null, [user, firestore]);
  const transactionsRef = useMemoFirebase(() => user && firestore ? query(collection(firestore, `users/${user.uid}/transactions`)) : null, [user, firestore]);
  
  const { data: memberList, isLoading: membersLoading } = useCollection<Member>(membersRef);
  const { data: transactionList, isLoading: txLoading } = useCollection<Transaction>(transactionsRef);

  const loading = membersLoading || txLoading;

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isPassbookOpen, setIsPassbookOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isCloseAccountDialogOpen, setIsCloseAccountDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const memberBalances = useMemo(() => {
    const balances = new Map<string, { depositBalance: number, loanBalance: number }>();
    if (!transactionList) return balances;

    for(const tx of transactionList) {
        if (!balances.has(tx.memberId)) {
            balances.set(tx.memberId, { depositBalance: 0, loanBalance: 0 });
        }
        const current = balances.get(tx.memberId)!;
        if(tx.type === 'deposit') {
            current.depositBalance += tx.amount;
        } else if (tx.type === 'loan') {
            current.loanBalance += tx.amount;
        } else if (tx.type === 'repayment') {
            current.loanBalance -= (tx.principal || 0);
        } else if (tx.type === 'loan-waived') {
            current.loanBalance -= tx.amount;
        }
    }
    return balances;
  }, [transactionList]);


  const filteredMembers = useMemo(() => {
    if (!memberList) return [];
    if (!searchQuery) return memberList;

    const lowercasedQuery = searchQuery.toLowerCase();
    return memberList.filter(member => 
        member.name.toLowerCase().includes(lowercasedQuery) ||
        member.id.toLowerCase().includes(lowercasedQuery) ||
        member.phone.includes(searchQuery) ||
        member.aadhaar.includes(searchQuery.replace(/-/g, ''))
    );
  }, [memberList, searchQuery]);


  const handleEdit = (member: Member) => {
    setSelectedMember(member);
    setIsEditDialogOpen(true);
  };

  const handlePassbook = (member: Member) => {
    setSelectedMember(member);
    setIsPassbookOpen(true);
  }

  const handleCloseAccount = (member: Member) => {
    const balances = memberBalances.get(member.id);
    if ((balances?.loanBalance || 0) > 0) {
        toast({
            variant: 'destructive',
            title: 'Account Closure Not Allowed',
            description: `${member.name} has an outstanding loan balance. Please clear all loans before closing the account.`,
        });
        return;
    }
    setSelectedMember(member);
    setIsCloseAccountDialogOpen(true);
  }

  const handleDelete = (member: Member) => {
    const balances = memberBalances.get(member.id);
    if ((balances?.loanBalance || 0) > 0) {
        toast({
            variant: 'destructive',
            title: 'Deletion Not Allowed',
            description: `${member.name} has an outstanding loan balance. Please clear the loan before deleting the member.`,
        });
        return;
    }
    setSelectedMember(member);
    setIsDeleteDialogOpen(true);
  }
  
  const handleStatusChange = async (member: Member, newStatus: 'active' | 'inactive' | 'closed') => {
    if (!user || !firestore) return;

    setIsUpdatingStatus(true);
    
    const memberDocRef = doc(firestore, `users/${user.uid}/members`, member.id);

    try {
        await updateDoc(memberDocRef, { status: newStatus });
        toast({
            title: 'Status Updated',
            description: `${member.name}'s account is now ${newStatus}.`,
        });

    } catch (error: any) {
         toast({
            variant: 'destructive',
            title: 'Update Failed',
            description: error.message || 'There was a problem updating the member status.',
        });
    } finally {
        setIsUpdatingStatus(false);
        if (newStatus === 'closed') {
            setIsCloseAccountDialogOpen(false);
            setSelectedMember(undefined);
        }
    }
  }


  const handleDeleteConfirm = async () => {
    if (!selectedMember || !user || !firestore) return;
    setIsDeleting(true);
    try {
        const memberId = selectedMember.id;
        const batch = writeBatch(firestore);

        const memberDocRef = doc(firestore, `users/${user.uid}/members`, memberId);
        
        const transactionsQuery = query(collection(firestore, `users/${user.uid}/transactions`), where('memberId', '==', memberId));
        const transactionsSnapshot = await getDocs(transactionsQuery);
        transactionsSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        batch.delete(memberDocRef);

        await batch.commit();

        toast({
            title: 'Success!',
            description: `Member ${selectedMember.name} and all their transactions have been deleted.`,
        });

    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Uh oh! Something went wrong.',
            description: error.message || 'There was a problem deleting the member.',
        });
    } finally {
        setIsDeleting(false);
        setIsDeleteDialogOpen(false);
        setSelectedMember(undefined);
    }
  };

  const getInitials = (name: string) => {
    const names = name.split(' ');
    const initials = names.map(n => n[0]).join('');
    return initials.toUpperCase();
  }
  
  const getStatusBadge = (status: Member['status']) => {
    switch (status) {
        case 'active':
            return <Badge variant="secondary" className='w-fit bg-green-100 text-green-800'>Active</Badge>;
        case 'inactive':
            return <Badge variant="secondary" className='w-fit bg-red-100 text-red-800'>Inactive</Badge>;
        case 'closed':
             return <Badge variant="secondary" className='w-fit bg-gray-100 text-gray-800'>Closed</Badge>;
        default:
            return null;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold font-headline">Members</h1>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Member
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="font-headline">Add New Member</DialogTitle>
              <DialogDescription>
                Enter the details of the new member to add them to the group.
              </DialogDescription>
            </DialogHeader>
            <MemberForm onOpenChange={setIsAddDialogOpen} />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Member Roster</CardTitle>
           <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, ID, phone, Aadhaar..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Member ID</TableHead>
                <TableHead>Mob No.</TableHead>
                <TableHead>Deposit Balance</TableHead>
                <TableHead className="text-right">Loan Balance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-6 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredMembers && filteredMembers.length > 0 ? (
                filteredMembers.map((member) => (
                  <TableRow key={member.id} className={cn((member.status === 'inactive' || member.status === 'closed') && 'bg-muted/50 text-muted-foreground')}>
                    <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                            <Avatar>
                                <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                                <span>{member.name}</span>
                                {getStatusBadge(member.status)}
                            </div>
                        </div>
                    </TableCell>
                    <TableCell>{member.id}</TableCell>
                    <TableCell>{member.phone}</TableCell>
                    <TableCell className="font-mono">Rs. {(memberBalances.get(member.id)?.depositBalance || 0).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right font-mono">Rs. {(memberBalances.get(member.id)?.loanBalance || 0).toLocaleString('en-IN')}</TableCell>
                     <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0" disabled={isUpdatingStatus && selectedMember?.id === member.id}>
                            {(isUpdatingStatus && selectedMember?.id === member.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                            <span className="sr-only">Open menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                           <DropdownMenuItem onClick={() => handleEdit(member)} disabled={member.status === 'closed'}>
                            <Pencil className="mr-2 h-4 w-4" />
                            <span>Edit</span>
                          </DropdownMenuItem>
                           <DropdownMenuItem onClick={() => handlePassbook(member)}>
                            <BookUser className="mr-2 h-4 w-4" />
                            <span>Passbook</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {member.status === 'active' ? (
                            <DropdownMenuItem onClick={() => handleStatusChange(member, 'inactive')} disabled={member.status === 'closed'}>
                                <UserX className="mr-2 h-4 w-4" />
                                <span>Deactivate</span>
                            </DropdownMenuItem>
                          ) : member.status === 'inactive' ? (
                            <DropdownMenuItem onClick={() => handleStatusChange(member, 'active')} disabled={member.status === 'closed'}>
                                <UserCheck className="mr-2 h-4 w-4" />
                                <span>Activate</span>
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onClick={() => handleCloseAccount(member)} disabled={member.status === 'closed'}>
                            <Archive className="mr-2 h-4 w-4" />
                            <span>Close Account</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDelete(member)} className="text-destructive focus:bg-destructive/10 focus:text-destructive" disabled={member.status === 'closed'}>
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
                    {searchQuery ? 'No members match your search.' : 'No members found.'}
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
            <DialogTitle className="font-headline">Edit Member</DialogTitle>
            <DialogDescription>
              Update the member's details below.
            </DialogDescription>
          </DialogHeader>
          {selectedMember && <MemberForm onOpenChange={setIsEditDialogOpen} member={selectedMember} isEdit={true} />}
        </DialogContent>
      </Dialog>

      <Dialog open={isPassbookOpen} onOpenChange={setIsPassbookOpen}>
        <DialogContent className="sm:max-w-lg h-[90vh] flex flex-col p-0 gap-0">
            {selectedMember && memberList && <PassbookView member={selectedMember} allMembers={memberList} transactions={transactionList} />}
        </DialogContent>
      </Dialog>

       <AlertDialog open={isCloseAccountDialogOpen} onOpenChange={setIsCloseAccountDialogOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you sure you want to close this account?</AlertDialogTitle>
                <AlertDialogDescription>
                    This will permanently close the account for <span className="font-bold">{selectedMember?.name}</span>. The member's financial history will be preserved, but they cannot be reactivated. Ensure all loans are cleared before proceeding.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleStatusChange(selectedMember!, 'closed')} disabled={isUpdatingStatus}>
                    {isUpdatingStatus && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Yes, close account
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the member <span className="font-bold">{selectedMember?.name}</span> and all of their associated transactions.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive hover:bg-destructive/90" disabled={isDeleting}>
                    {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Yes, delete member
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

    