import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin, useSetupPassword, useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, LogIn, KeyRound } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  
  const [setupEmail, setSetupEmail] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirmPassword, setSetupConfirmPassword] = useState("");

  const loginMutation = useLogin();
  const setupMutation = useSetupPassword();

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (isAuthenticated) {
    setLocation("/");
    return null;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await loginMutation.mutateAsync({ email: loginEmail, password: loginPassword });
      toast({ title: "Welcome back!", description: "You have been logged in successfully." });
      setLocation("/");
    } catch (error: any) {
      const message = error?.message || "Login failed";
      toast({ 
        title: "Login Failed", 
        description: message,
        variant: "destructive" 
      });
    }
  };

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (setupPassword !== setupConfirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    try {
      await setupMutation.mutateAsync({ 
        email: setupEmail, 
        password: setupPassword, 
        confirmPassword: setupConfirmPassword 
      });
      toast({ title: "Password Set!", description: "Your password has been set. You are now logged in." });
      setLocation("/");
    } catch (error: any) {
      const message = error?.message || "Failed to set password";
      toast({ 
        title: "Setup Failed", 
        description: message,
        variant: "destructive" 
      });
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Merchandising ERP</CardTitle>
          <CardDescription>Sign in to access your dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" data-testid="tab-login">
                <LogIn className="h-4 w-4 mr-2" />
                Login
              </TabsTrigger>
              <TabsTrigger value="setup" data-testid="tab-setup-password">
                <KeyRound className="h-4 w-4 mr-2" />
                Set Password
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="your.email@company.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    data-testid="input-login-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="Enter your password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    data-testid="input-login-password"
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={loginMutation.isPending}
                  data-testid="button-login"
                >
                  {loginMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      <LogIn className="mr-2 h-4 w-4" />
                      Sign In
                    </>
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="setup">
              <form onSubmit={handleSetupPassword} className="space-y-4">
                <p className="text-sm text-muted-foreground mb-4">
                  First time? Enter your work email and set your password.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="setup-email">Work Email</Label>
                  <Input
                    id="setup-email"
                    type="email"
                    placeholder="your.email@company.com"
                    value={setupEmail}
                    onChange={(e) => setSetupEmail(e.target.value)}
                    required
                    data-testid="input-setup-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-password">New Password</Label>
                  <Input
                    id="setup-password"
                    type="password"
                    placeholder="Create a password (min 6 characters)"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    required
                    minLength={6}
                    data-testid="input-setup-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-confirm">Confirm Password</Label>
                  <Input
                    id="setup-confirm"
                    type="password"
                    placeholder="Confirm your password"
                    value={setupConfirmPassword}
                    onChange={(e) => setSetupConfirmPassword(e.target.value)}
                    required
                    data-testid="input-setup-confirm"
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={setupMutation.isPending}
                  data-testid="button-setup-password"
                >
                  {setupMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      <KeyRound className="mr-2 h-4 w-4" />
                      Set Password & Sign In
                    </>
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
