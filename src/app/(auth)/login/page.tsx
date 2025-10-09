'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import Link from 'next/link';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { GoogleAuthProvider, signInWithPopup, UserCredential, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, query } from 'firebase/firestore';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useAuth, useFirestore } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { GroupSettings, Member } from '@/types';
import { Separator } from '@/components/ui/separator';

const formSchema = z.object({
  email: z.string().email({ message: 'Invalid email address.' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters.' }),
});

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="24px" height="24px">
      <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
      <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
      <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.222,0-9.565-3.108-11.283-7.562l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
      <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.574l6.19,5.238C39.99,36.596,44,31.023,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
    </svg>
  );
}

const createDefaultSettings = async (firestore: any, userId: string) => {
    const settingsDocRef = doc(firestore, `users/${userId}/groupSettings`, 'settings');
    const docSnap = await getDoc(settingsDocRef);

    if (!docSnap.exists()) {
      console.log(`Creating default settings for user ${userId}...`);
      
      const membersRef = collection(firestore, `users/${userId}/members`);
      const membersQuery = query(membersRef);
      const membersSnapshot = await getDocs(membersQuery);
      
      let totalFund = 0;
      let totalMembers = 0;
      if (!membersSnapshot.empty) {
        totalMembers = membersSnapshot.size;
        membersSnapshot.forEach(doc => {
          const member = doc.data() as Member;
          totalFund += member.currentBalance;
        });
      }

      const defaultSettings: GroupSettings = {
        groupName: 'My Savings Group',
        monthlyContribution: 1000,
        interestRate: 2,
        totalMembers: totalMembers,
        totalFund: totalFund,
        establishedDate: new Date().toISOString(),
      };
      await setDoc(settingsDocRef, defaultSettings);
    } else {
        console.log(`Settings already exist for user ${userId}.`);
    }
}


export default function LoginPage() {
  const auth = useAuth();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  async function onEmailSubmit(values: z.infer<typeof formSchema>) {
    if (!auth || !firestore) return;
    setIsLoading(true);
    try {
        const result: UserCredential = await signInWithEmailAndPassword(auth, values.email, values.password);
        const user = result.user;
        await createDefaultSettings(firestore, user.uid);
    } catch(error: any) {
         toast({
            variant: 'destructive',
            title: 'Sign In Failed',
            description: error.message || 'An unexpected error occurred during email sign-in.',
          });
          setIsLoading(false);
    }
  }

  async function onGoogleSubmit() {
    if (!auth || !firestore) return;
    setIsGoogleLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result: UserCredential = await signInWithPopup(auth, provider);
      const user = result.user;
      await createDefaultSettings(firestore, user.uid);
      // Redirect is handled by the layout
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Sign In Failed',
        description: error.message || 'An unexpected error occurred during Google Sign-In.',
      });
      setIsGoogleLoading(false);
    }
  }


  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="font-headline text-2xl">Welcome to Sahayak Savings</CardTitle>
        <CardDescription>Sign in to your account to continue.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onEmailSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="name@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isLoading || isGoogleLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign In with Email
            </Button>
          </form>
        </Form>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or continue with
            </span>
          </div>
        </div>
        <Button variant="outline" className="w-full" onClick={onGoogleSubmit} disabled={isLoading || isGoogleLoading}>
          {isGoogleLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          Sign In with Google
        </Button>
      </CardContent>
      <CardFooter className="text-sm justify-center">
        <p>
          Don&apos;t have an account?{' '}
          <Button variant="link" asChild className="p-0">
            <Link href="/signup">Sign up</Link>
          </Button>
        </p>
      </CardFooter>
    </Card>
  );
}
