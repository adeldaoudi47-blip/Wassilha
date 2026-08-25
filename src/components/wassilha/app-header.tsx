'use client';

import { LogOut, RefreshCw, UserCog, Bike, User } from 'lucide-react';
import { BrandLogo } from './brand-logo';
import { LangToggle } from './lang-toggle';
import { useT } from './use-t';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { useNavStore } from '@/lib/store';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';

// SECURITY: the role-switch menu talks to /api/auth/login-as, which is hard-
// disabled outside local development — so only render it in that mode.
const ENABLE_DEMO_LOGIN =
  process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}

export function AppHeader({ title, subtitle, rightSlot }: AppHeaderProps) {
  const { t, isAr } = useT();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch { /* ignore */ }
    setUser(null);
    toast.success(isAr ? 'تم تسجيل الخروج' : 'Déconnecté');
  };

  const switchRole = async (role: Role) => {
    try {
      const { user: u } = await api.loginAs(role);
      setUser(u);
      toast.success(isAr ? `تم التبديل إلى ${role === 'customer' ? t.customer : role === 'driver' ? t.driver : t.admin}` : `Rôle: ${role}`);
    } catch {
      toast.error(isAr ? 'فشل التبديل' : 'Échec');
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
        <BrandLogo size={36} />
        <div className={cn('min-w-0 flex-1', isAr ? 'text-right' : 'text-left')}>
          <h1 className="truncate text-base font-bold leading-tight text-foreground">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {rightSlot}
        <LangToggle />
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                <Avatar className="h-9 w-9 border-2 border-primary/20">
                  <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                    {user.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{user.name}</span>
                <span className="text-xs font-normal text-muted-foreground" dir="ltr">{user.phone}</span>
                <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {user.role === 'customer' ? t.customer : user.role === 'driver' ? t.driver : t.admin}
                </span>
              </DropdownMenuLabel>
              {ENABLE_DEMO_LOGIN && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">{t.switchRole}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => switchRole('customer')}>
                    <User className="text-sky-500" size={15} />
                    <span>{t.switchToCustomer}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => switchRole('driver')}>
                    <Bike className="text-emerald-500" size={15} />
                    <span>{t.switchToDriver}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => switchRole('admin')}>
                    <UserCog className="text-orange-500" size={15} />
                    <span>{t.switchToAdmin}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                <LogOut size={15} />
                <span>{t.logout}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
