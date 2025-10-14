'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  ArrowRightLeft,
  Settings,
  HandCoins,
  FileText,
  LibraryBig,
  Banknote,
} from 'lucide-react';

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/members', label: 'Members', icon: Users },
  { href: '/transactions', label: 'Transactions', icon: ArrowRightLeft },
  { href: '/bulk-deposit', label: 'Bulk Deposit', icon: Banknote },
  { href: '/summary', label: 'Summary', icon: LibraryBig },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" variant="sidebar" side="left">
      <SidebarHeader className="h-16 justify-center text-primary">
        <Link href="/dashboard" className="flex items-center gap-2">
          <HandCoins className="h-8 w-8" />
          <div className="flex flex-col">
            <h1 className="font-headline text-xl font-bold tracking-tight">
              Yuva Finance
            </h1>
            <p className="text-xs text-primary/80 -mt-1">Group</p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))}
                tooltip={{ children: item.label, className: 'font-body' }}
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="hidden">
        {/* Can be used for extra info or actions */}
      </SidebarFooter>
    </Sidebar>
  );
}
